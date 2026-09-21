use anyhow::{anyhow, Context};
use reqwest::Client;
use serde_json::{json, Value};

use crate::models::{ApiMessage, ChatResponse, OpenAiChoice, OpenAiErrorResponse};

const HTTP_TIMEOUT_SECS: u64 = 120;

/// Build a shared reqwest client used across the application.
pub fn build_http_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .expect("failed to create HTTP client")
}

/// Anthropic Messages API constants.
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Anthropic requires max_tokens; the UI has no such knob yet, so a generous
/// default is sent (model-side caps still apply).
const ANTHROPIC_MAX_TOKENS: u32 = 8192;

/// Send a single chat request using the profile's wire protocol.
pub async fn send_chat(
    client: &Client,
    profile: &crate::models::AiProfile,
    messages: &[ApiMessage],
) -> anyhow::Result<ChatResponse> {
    match profile.api_protocol.trim() {
        "anthropic-messages" => send_anthropic_messages(client, profile, messages).await,
        "openai-responses" => send_openai_responses(client, profile, messages).await,
        _ => send_openai_compatible(client, profile, messages).await,
    }
}

/// Pre-flight checks shared by every protocol sender.
fn ensure_profile_ready(profile: &crate::models::AiProfile) -> anyhow::Result<()> {
    if profile.api_key.trim().is_empty() {
        return Err(anyhow!("请先为 {} 填写 API Key", profile.name));
    }
    if profile.endpoint.trim().is_empty() {
        return Err(anyhow!("请先为 {} 填写 API 地址", profile.name));
    }
    if !(profile.endpoint.trim().starts_with("https://") || profile.endpoint.trim().starts_with("http://")) {
        return Err(anyhow!(
            "{} 的 API 地址必须以 http:// 或 https:// 开头",
            profile.name
        ));
    }
    if profile.model.trim().is_empty() {
        return Err(anyhow!("请先为 {} 填写模型名称", profile.name));
    }
    Ok(())
}

/// Ensure the endpoint carries the given protocol suffix (idempotent).
fn normalize_endpoint_with_suffix(input: &str, suffix: &str) -> String {
    let endpoint = input.trim().trim_end_matches('/');
    if endpoint.is_empty() || endpoint.ends_with(suffix) {
        return endpoint.to_string();
    }
    format!("{endpoint}{suffix}")
}

/// Send a single chat request to an OpenAI-compatible endpoint.
pub async fn send_openai_compatible(
    client: &Client,
    profile: &crate::models::AiProfile,
    messages: &[ApiMessage],
) -> anyhow::Result<ChatResponse> {
    ensure_profile_ready(profile)?;
    let endpoint = normalize_chat_endpoint(profile.endpoint.trim());

    let mut payload_messages = Vec::new();
    if !profile.system_prompt.trim().is_empty() {
        payload_messages.push(json!({
            "role": "system",
            "content": profile.system_prompt,
        }));
    }
    for msg in messages {
        if msg.content.trim().is_empty() {
            continue;
        }
        let mut entry = json!({
            "role": msg.role,
            "content": msg.content,
        });
        if let Some(name) = &msg.name {
            if !name.is_empty() {
                entry["name"] = json!(name);
            }
        }
        payload_messages.push(entry);
    }
    if payload_messages.is_empty() {
        return Err(anyhow!("没有可发送的消息内容"));
    }

    let response = client
        .post(&endpoint)
        .bearer_auth(profile.api_key.trim())
        .json(&json!({
            "model": profile.model.trim(),
            "messages": payload_messages,
            "temperature": profile.temperature.clamp(0.0, 2.0),
        }))
        .send()
        .await
        .context("请求 AI 服务失败")?;

    let status = response.status();
    let body = response.text().await.context("无法读取 AI 服务响应")?;
    if !status.is_success() {
        return Err(anyhow!(
            "AI 服务返回 {status}: {}",
            readable_error_body(&body)
        ));
    }

    let value: Value = serde_json::from_str(&body).context("AI 服务响应不是有效 JSON")?;
    let parsed: Result<Vec<OpenAiChoice>, _> = serde_json::from_value(
        value
            .get("choices")
            .cloned()
            .ok_or_else(|| anyhow!("AI 服务响应缺少 choices 字段"))?,
    );
    let choices = parsed.context("AI 服务响应 choices 格式不兼容")?;
    let content = choices
        .first()
        .and_then(|choice| choice.message.content.as_ref())
        .and_then(extract_message_content)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| anyhow!("AI 服务没有返回文本内容"))?;

    Ok(ChatResponse { content })
}

/// Send a single chat request to an Anthropic Messages endpoint.
pub async fn send_anthropic_messages(
    client: &Client,
    profile: &crate::models::AiProfile,
    messages: &[ApiMessage],
) -> anyhow::Result<ChatResponse> {
    ensure_profile_ready(profile)?;
    let endpoint = normalize_endpoint_with_suffix(profile.endpoint.trim(), "/v1/messages");

    // Anthropic takes the system prompt as a top-level field and only
    // accepts user/assistant turns in `messages`.
    let mut system_parts: Vec<String> = Vec::new();
    if !profile.system_prompt.trim().is_empty() {
        system_parts.push(profile.system_prompt.trim().to_string());
    }
    let mut turns: Vec<Value> = Vec::new();
    for msg in messages {
        if msg.content.trim().is_empty() {
            continue;
        }
        match msg.role.as_str() {
            "system" => system_parts.push(msg.content.trim().to_string()),
            "assistant" => turns.push(json!({ "role": "assistant", "content": msg.content })),
            _ => turns.push(json!({ "role": "user", "content": msg.content })),
        }
    }
    if turns.is_empty() {
        return Err(anyhow!("没有可发送的消息内容"));
    }

    let mut payload = json!({
        "model": profile.model.trim(),
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "messages": turns,
        "temperature": profile.temperature.clamp(0.0, 2.0),
    });
    if !system_parts.is_empty() {
        payload["system"] = json!(system_parts.join("\n\n"));
    }

    let response = client
        .post(&endpoint)
        .header("x-api-key", profile.api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&payload)
        .send()
        .await
        .context("请求 AI 服务失败")?;

    let status = response.status();
    let body = response.text().await.context("无法读取 AI 服务响应")?;
    if !status.is_success() {
        return Err(anyhow!(
            "AI 服务返回 {status}: {}",
            readable_error_body(&body)
        ));
    }

    let value: Value = serde_json::from_str(&body).context("AI 服务响应不是有效 JSON")?;
    let text = value
        .get("content")
        .and_then(|c| c.as_array())
        .ok_or_else(|| anyhow!("AI 服务响应缺少 content 字段"))?
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        return Err(anyhow!("AI 服务没有返回文本内容"));
    }
    Ok(ChatResponse { content: text })
}

/// Send a single chat request to an OpenAI Responses endpoint.
pub async fn send_openai_responses(
    client: &Client,
    profile: &crate::models::AiProfile,
    messages: &[ApiMessage],
) -> anyhow::Result<ChatResponse> {
    ensure_profile_ready(profile)?;
    let endpoint = normalize_endpoint_with_suffix(profile.endpoint.trim(), "/responses");

    // The Responses API carries the system prompt in `instructions` and the
    // conversation in `input`.
    let mut input: Vec<Value> = Vec::new();
    for msg in messages {
        if msg.content.trim().is_empty() || msg.role == "system" {
            continue;
        }
        input.push(json!({ "role": msg.role, "content": msg.content }));
    }
    if input.is_empty() {
        return Err(anyhow!("没有可发送的消息内容"));
    }

    let mut payload = json!({
        "model": profile.model.trim(),
        "input": input,
        "temperature": profile.temperature.clamp(0.0, 2.0),
    });
    if !profile.system_prompt.trim().is_empty() {
        payload["instructions"] = json!(profile.system_prompt);
    }

    let response = client
        .post(&endpoint)
        .bearer_auth(profile.api_key.trim())
        .json(&payload)
        .send()
        .await
        .context("请求 AI 服务失败")?;

    let status = response.status();
    let body = response.text().await.context("无法读取 AI 服务响应")?;
    if !status.is_success() {
        return Err(anyhow!(
            "AI 服务返回 {status}: {}",
            readable_error_body(&body)
        ));
    }

    let value: Value = serde_json::from_str(&body).context("AI 服务响应不是有效 JSON")?;
    let text = value
        .get("output")
        .and_then(|o| o.as_array())
        .ok_or_else(|| anyhow!("AI 服务响应缺少 output 字段"))?
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|item| item.get("content").and_then(|c| c.as_array()))
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("output_text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        return Err(anyhow!("AI 服务没有返回文本内容"));
    }
    Ok(ChatResponse { content: text })
}

fn normalize_chat_endpoint(input: &str) -> String {
    let endpoint = input.trim().trim_end_matches('/');
    if endpoint.is_empty()
        || endpoint.ends_with("/chat/completions")
        || endpoint.ends_with("/responses")
    {
        return endpoint.to_string();
    }
    format!("{endpoint}/chat/completions")
}

fn extract_message_content(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.to_string()),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    part.as_str()
                        .map(str::to_string)
                        .or_else(|| part.get("text").and_then(Value::as_str).map(str::to_string))
                })
                .collect::<Vec<_>>()
                .join("");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn readable_error_body(body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<OpenAiErrorResponse>(body) {
        return parsed.error.message;
    }
    const MAX_ERROR_LEN: usize = 800;
    if body.chars().count() > MAX_ERROR_LEN {
        format!(
            "{}...",
            body.chars().take(MAX_ERROR_LEN).collect::<String>()
        )
    } else {
        body.to_string()
    }
}
