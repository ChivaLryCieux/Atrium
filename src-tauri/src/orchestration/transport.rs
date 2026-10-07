use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::models::{KernelTurnResponse, KernelUsageInfo};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelTurnRequest {
    pub conversation_id: String,
    pub stage_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<String>,
    pub prompt: String,
}

/// Find the boundary of the next complete SSE message in a byte buffer.
/// Matches either `\n\n` (len 2) or `\r\n\r\n` (len 4).
/// In UTF-8, neither `\r` (0x0D) nor `\n` (0x0A) can ever appear as part of a
/// multi-byte sequence, ensuring clean character and message boundaries.
pub fn find_sse_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    if buf.len() < 2 {
        return None;
    }
    for i in 0..buf.len() - 1 {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if i + 3 < buf.len() && &buf[i..i + 4] == b"\r\n\r\n" {
            return Some((i, 4));
        }
    }
    None
}

pub async fn post_turn(
    app: &AppHandle,
    http: &Client,
    daemon_url: &str,
    request: &KernelTurnRequest,
    timeout: std::time::Duration,
) -> Result<KernelTurnResponse, String> {
    #[cfg(target_os = "windows")]
    {
        let pipe_target = if let Some(state) = tauri::Manager::try_state::<crate::AppState>(app) {
            let daemon = state.daemon.lock().await;
            daemon.connection.pipe.clone().map(|p| (p, daemon.connection.token.clone()))
        } else {
            None
        };

        if let Some((pipe_name, token)) = pipe_target {
            if let Ok(body_json) = serde_json::to_string(request) {
                match crate::named_pipe_http::post_turn_via_pipe(
                    app,
                    &pipe_name,
                    token.as_deref(),
                    &body_json,
                    timeout,
                ).await {
                    Ok(mut pipe_response) => {
                        pipe_response.kernel_route = Some(format!("named_pipe:{pipe_name}"));
                        return Ok(pipe_response);
                    }
                    Err(pipe_err) => {
                        eprintln!("[ATRIUM_IPC] Named pipe fast-path degraded: {pipe_err}, falling back to loopback TCP");
                    }
                }
            }
        }
    }

    let url = format!("{daemon_url}/v1/turn");
    let mut req_builder = http.post(&url).json(request);
    if let Some(state) = tauri::Manager::try_state::<crate::AppState>(app) {
        let daemon = state.daemon.lock().await;
        if let Some(token) = &daemon.connection.token {
            req_builder = req_builder.bearer_auth(token);
        }
    }
    let future = req_builder.send();
    let response = tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| "节点执行超时（内核熔断保护）".to_string())?
        .map_err(|e| format!("内核桥接请求失败: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_else(|| {
                let mut preview = body.chars().take(300).collect::<String>();
                if preview.len() < body.len() {
                    preview.push('…');
                }
                preview
            });
        return Err(format!("内核返回 {status}: {detail}"));
    }

    let is_sse = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("text/event-stream"))
        .unwrap_or(false);

    if !is_sse {
        let body = response.text().await.unwrap_or_default();
        return serde_json::from_str(&body).map_err(|e| format!("内核响应解析失败: {e}"));
    }

    let mut stream = response.bytes_stream();
    let mut byte_buffer: Vec<u8> = Vec::with_capacity(16384);
    let mut final_turn: Option<KernelTurnResponse> = None;
    let mut accumulated_text = String::new();
    let mut accumulated_reasoning = String::new();
    let mut stream_tool_calls: Vec<crate::models::ToolCallRecord> = Vec::new();
    let mut last_error_msg: Option<String> = None;

    while let Some(chunk_result) = stream.next().await {
        if super::common::is_conversation_cancelled(&request.conversation_id).await {
            break;
        }
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[ATRIUM_SSE] Error reading chunk: {e}");
                break;
            }
        };

        byte_buffer.extend_from_slice(&chunk);

        while let Some((msg_end, delim_len)) = find_sse_boundary(&byte_buffer) {
            let message_bytes = &byte_buffer[..msg_end];
            let message = String::from_utf8_lossy(message_bytes);

            let mut current_event_type = String::new();
            let mut data_str = String::new();
            for line in message.lines() {
                if let Some(event_val) = line.strip_prefix("event: ") {
                    current_event_type = event_val.trim().to_string();
                } else if let Some(data_val) = line.strip_prefix("data: ") {
                    data_str = data_val.trim().to_string();
                }
            }

            byte_buffer.drain(..msg_end + delim_len);

            if data_str.is_empty() {
                continue;
            }

            match current_event_type.as_str() {
                "stream" => {
                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        let _ = app.emit("kernel-stream-event", &json_val);

                        if let Some(msg_type) = json_val.get("type").and_then(|v| v.as_str()) {
                            if msg_type == "assistant-stream" {
                                if let Some(content) = json_val.get("content").and_then(|v| v.as_str()) {
                                    let is_reasoning = json_val.get("isReasoning").and_then(|v| v.as_bool()).unwrap_or(false);
                                    if is_reasoning {
                                        accumulated_reasoning.push_str(content);
                                    } else {
                                        accumulated_text.push_str(content);
                                    }
                                }
                            } else if msg_type == "tool-event" {
                                if let Some(event_obj) = json_val.get("event") {
                                    if let Some(kind) = event_obj.get("kind").and_then(|v| v.as_str()) {
                                        if kind == "call" {
                                            if let Some(item) = event_obj.get("item") {
                                                if let Ok(tool_record) = serde_json::from_value::<crate::models::ToolCallRecord>(item.clone()) {
                                                    stream_tool_calls.push(tool_record);
                                                }
                                            }
                                        } else if kind == "result" {
                                            if let Some(call_id) = event_obj.get("callId").and_then(|v| v.as_str()) {
                                                if let Some(call) = stream_tool_calls.iter_mut().find(|c| c.id == call_id) {
                                                    call.result = event_obj.get("result").and_then(|v| v.as_str()).map(str::to_string);
                                                    call.is_error = event_obj.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
                                                    call.error = event_obj.get("error").and_then(|v| v.as_str()).map(str::to_string);
                                                    call.status = event_obj.get("status").and_then(|v| v.as_str()).unwrap_or("completed").to_string();
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                "done" => {
                    match serde_json::from_str::<KernelTurnResponse>(&data_str) {
                        Ok(resp) => {
                            final_turn = Some(resp);
                        }
                        Err(e) => {
                            eprintln!("[ATRIUM_SSE] Failed to parse done payload directly: {e}, falling back to tolerant extraction");
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&data_str) {
                                let session_id = val.get("sessionId").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                                let mut final_response = val.get("finalResponse").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                                if final_response.is_empty() && !accumulated_text.is_empty() {
                                    final_response = accumulated_text.clone();
                                }
                                let reasoning_content = val.get("reasoningContent")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string)
                                    .or_else(|| if !accumulated_reasoning.is_empty() { Some(accumulated_reasoning.clone()) } else { None });

                                let usage = val.get("usage").and_then(|u| serde_json::from_value::<KernelUsageInfo>(u.clone()).ok());
                                let tool_calls = val.get("toolCalls")
                                    .and_then(|tc| serde_json::from_value::<Vec<crate::models::ToolCallRecord>>(tc.clone()).ok())
                                    .or_else(|| if !stream_tool_calls.is_empty() { Some(stream_tool_calls.clone()) } else { None });

                                final_turn = Some(KernelTurnResponse {
                                    session_id,
                                    final_response,
                                    reasoning_content,
                                    input_tokens: None,
                                    output_tokens: None,
                                    usage,
                                    tool_calls,
                                    kernel_route: None,
                                });
                            }
                        }
                    }
                }
                "error" => {
                    if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        let msg = err_val
                            .get("error")
                            .and_then(|e| e.as_str())
                            .unwrap_or("内核内部执行错误")
                            .to_string();
                        last_error_msg = Some(msg);
                    }
                }
                _ => {}
            }
        }
    }

    if super::common::is_conversation_cancelled(&request.conversation_id).await {
        return Ok(KernelTurnResponse {
            session_id: request.conversation_id.clone(),
            final_response: if accumulated_text.trim().is_empty() {
                "*(操作员已暂停)*".to_string()
            } else {
                format!("{}\n\n*(操作员已暂停)*", accumulated_text.trim())
            },
            reasoning_content: if accumulated_reasoning.is_empty() { None } else { Some(accumulated_reasoning) },
            input_tokens: None,
            output_tokens: None,
            usage: None,
            tool_calls: if stream_tool_calls.is_empty() { None } else { Some(stream_tool_calls) },
            kernel_route: Some("aborted".to_string()),
        });
    }

    if let Some(mut turn) = final_turn {
        if turn.final_response.trim().is_empty() && !accumulated_text.is_empty() {
            turn.final_response = accumulated_text;
        }
        if turn.reasoning_content.is_none() && !accumulated_reasoning.is_empty() {
            turn.reasoning_content = Some(accumulated_reasoning);
        }
        let has_content = !turn.final_response.trim().is_empty();
        let has_reasoning = turn.reasoning_content.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
        let has_tools = turn.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
        if !has_content && !has_reasoning && !has_tools {
            if let Some(err) = last_error_msg {
                return Err(err);
            }
            return Err("模型未返回有效回复内容，请检查端点配置、API Key 与网络状态。".to_string());
        }
        return Ok(turn);
    }

    if !accumulated_text.is_empty() || !accumulated_reasoning.is_empty() {
        eprintln!(
            "[ATRIUM_SSE] Connection closed before 'done' event; salvaging {} chars text and {} chars reasoning",
            accumulated_text.len(),
            accumulated_reasoning.len()
        );
        return Ok(KernelTurnResponse {
            session_id: String::new(),
            final_response: accumulated_text,
            reasoning_content: if accumulated_reasoning.is_empty() { None } else { Some(accumulated_reasoning) },
            input_tokens: None,
            output_tokens: None,
            usage: None,
            tool_calls: if stream_tool_calls.is_empty() { None } else { Some(stream_tool_calls) },
            kernel_route: None,
        });
    }

    if let Some(err) = last_error_msg {
        return Err(err);
    }

    final_turn.ok_or_else(|| "内核流式响应提前终止，未返回结算结果".to_string())
}

#[cfg(test)]
mod tests {
    use super::find_sse_boundary;

    #[test]
    fn test_find_sse_boundary_lf() {
        let data = b"data: hello\n\ndata: next";
        assert_eq!(find_sse_boundary(data), Some((11, 2)));
    }

    #[test]
    fn test_find_sse_boundary_crlf() {
        let data = b"data: hello\r\n\r\ndata: next";
        assert_eq!(find_sse_boundary(data), Some((11, 4)));
    }

    #[test]
    fn test_find_sse_boundary_none() {
        let data = b"data: hello\ndata: next";
        assert_eq!(find_sse_boundary(data), None);
        assert_eq!(find_sse_boundary(b"a"), None);
        assert_eq!(find_sse_boundary(b""), None);
    }
}
