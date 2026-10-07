use tauri::{AppHandle, State};
use crate::models::{AiProfile, AppSettings};
use crate::storage;

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    storage::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    storage::save_settings(&app, &settings)
}

#[tauri::command]
pub fn create_profile() -> AiProfile {
    storage::create_profile()
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, profile_id: String) -> Result<AppSettings, String> {
    storage::delete_profile(&app, &profile_id)
}

const PROBE_PROMPT: &str = "ping";

struct ProbeOutcome {
    status: String,
    produced_text: bool,
}

fn probe_reply_has_text(protocol: &str, value: &serde_json::Value) -> bool {
    let text_field = |block: &serde_json::Value, key: &str| {
        block
            .get(key)
            .and_then(|t| t.as_str())
            .is_some_and(|t| !t.trim().is_empty())
    };
    match protocol.trim() {
        "anthropic-messages" => value
            .get("content")
            .and_then(|c| c.as_array())
            .is_some_and(|blocks| {
                blocks.iter().any(|b| {
                    b.get("type").and_then(|t| t.as_str()) == Some("text")
                        && text_field(b, "text")
                })
            }),
        "openai-responses" => value
            .get("output")
            .and_then(|o| o.as_array())
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("content")
                        .and_then(|c| c.as_array())
                        .is_some_and(|blocks| {
                            blocks.iter().any(|b| {
                                b.get("type").and_then(|t| t.as_str()) == Some("output_text")
                                    && text_field(b, "text")
                            })
                        })
                })
            }),
        _ => value
            .get("choices")
            .and_then(|c| c.as_array())
            .is_some_and(|choices| {
                choices.iter().any(|choice| {
                    choice
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                        .is_some_and(|t| !t.trim().is_empty())
                })
            }),
    }
}

fn probe_status_hint(status: reqwest::StatusCode) -> &'static str {
    match status.as_u16() {
        401 | 403 => "请检查 API Key",
        404 => "请检查 API 地址与所选协议是否匹配（该端点可能未实现此协议路径）",
        429 => "请求过于频繁或额度不足",
        400 | 422 => "请检查模型名称与协议参数是否被该端点接受",
        _ => "请检查凭据或地址",
    }
}

async fn probe_inference(
    client: &reqwest::Client,
    protocol: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
) -> Result<ProbeOutcome, String> {
    let url = crate::ai_client::inference_endpoint(endpoint, protocol);
    if url.is_empty() {
        return Err("API 地址为空".to_string());
    }
    if api_key.is_empty() {
        return Err("请先填写 API Key".to_string());
    }
    if model.is_empty() {
        return Err("请先填写模型名称，真实探测需要它确认该模型可用".to_string());
    }

    let (payload, request) = match protocol.trim() {
        "anthropic-messages" => (
            serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{ "role": "user", "content": PROBE_PROMPT }],
            }),
            client
                .post(&url)
                .header("x-api-key", api_key)
                .header("anthropic-version", crate::ai_client::ANTHROPIC_VERSION),
        ),
        "openai-responses" => (
            serde_json::json!({
                "model": model,
                "input": [{ "role": "user", "content": PROBE_PROMPT }],
                "stream": false,
            }),
            client.post(&url).bearer_auth(api_key),
        ),
        _ => (
            serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": PROBE_PROMPT }],
                "stream": false,
            }),
            client.post(&url).bearer_auth(api_key),
        ),
    };

    let response = request
        .json(&payload)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("无法连通 {url}: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = crate::ai_client::readable_error_body(&body);
        let hint = probe_status_hint(status);
        return Err(if detail.trim().is_empty() {
            format!("{url} 返回 {status}，{hint}")
        } else {
            format!("{url} 返回 {status}（{hint}）：{detail}")
        });
    }

    let produced_text = serde_json::from_str::<serde_json::Value>(&body)
        .map(|value| probe_reply_has_text(protocol, &value))
        .unwrap_or(false);

    Ok(ProbeOutcome {
        status: status.to_string(),
        produced_text,
    })
}

#[tauri::command]
pub async fn probe_provider(
    state: State<'_, crate::AppState>,
    endpoint: String,
    api_key: String,
    api_protocol: String,
    model: String,
) -> Result<String, String> {
    let protocol = match api_protocol.trim() {
        "" | "openai-chat" | "openai-responses" | "anthropic-messages" => api_protocol.trim(),
        other => return Err(format!("未知的 API 协议 {other}，请在设置中重新选择")),
    };
    let started = std::time::Instant::now();
    let outcome =
        probe_inference(&state.http, protocol, endpoint.trim(), api_key.trim(), model.trim())
            .await?;
    let elapsed = started.elapsed().as_millis() as u64;
    let model = model.trim();

    if outcome.produced_text {
        Ok(format!(
            "推理连通正常（{} · {model} · {elapsed}ms），端点、凭据、协议与模型名均可用",
            outcome.status
        ))
    } else {
        Err(format!(
            "{model} 返回 {} 但没有产出任何文本，该模型或协议可能不受支持",
            outcome.status
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{probe_reply_has_text, probe_status_hint};
    use crate::ai_client::inference_endpoint;
    use reqwest::StatusCode;
    use serde_json::json;

    #[test]
    fn probe_targets_the_protocols_own_inference_path() {
        for (endpoint, protocol, expected) in [
            ("https://api.deepseek.com/v1", "openai-chat", "https://api.deepseek.com/v1/chat/completions"),
            ("https://api.deepseek.com/v1/chat/completions", "openai-chat", "https://api.deepseek.com/v1/chat/completions"),
            ("https://api.openai.com/v1", "openai-responses", "https://api.openai.com/v1/responses"),
            ("https://api.anthropic.com", "anthropic-messages", "https://api.anthropic.com/v1/messages"),
            ("https://api.anthropic.com/v1/messages", "anthropic-messages", "https://api.anthropic.com/v1/messages"),
        ] {
            assert_eq!(inference_endpoint(endpoint, protocol), expected);
        }
    }

    #[test]
    fn probe_reads_reply_text_per_protocol() {
        assert!(probe_reply_has_text(
            "openai-chat",
            &json!({"choices":[{"message":{"content":"pong"}}]})
        ));
        assert!(!probe_reply_has_text(
            "openai-chat",
            &json!({"choices":[{"message":{"content":"  "}}]})
        ));
        assert!(!probe_reply_has_text("openai-chat", &json!({"choices":[]})));

        assert!(probe_reply_has_text(
            "anthropic-messages",
            &json!({"content":[{"type":"text","text":"pong"}]})
        ));
        assert!(!probe_reply_has_text(
            "anthropic-messages",
            &json!({"content":[{"type":"thinking","thinking":"..."}]})
        ));

        assert!(probe_reply_has_text(
            "openai-responses",
            &json!({"output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]})
        ));
        assert!(!probe_reply_has_text("openai-responses", &json!({"output":[]})));
    }

    #[test]
    fn probe_hints_name_the_actual_remedy() {
        assert_eq!(probe_status_hint(StatusCode::UNAUTHORIZED), "请检查 API Key");
        assert_ne!(
            probe_status_hint(StatusCode::NOT_FOUND),
            probe_status_hint(StatusCode::TOO_MANY_REQUESTS)
        );
        assert_ne!(
            probe_status_hint(StatusCode::BAD_REQUEST),
            probe_status_hint(StatusCode::UNAUTHORIZED)
        );
    }
}
