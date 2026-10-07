use tauri::AppHandle;
use crate::models::{AiProfile, ChatMessage, KernelTurnResponse};

pub fn latest_user_input(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default()
}

pub fn kernel_base_url(endpoint: &str, api_protocol: &str) -> Option<String> {
    let mut trimmed = endpoint.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return None;
    }
    if api_protocol.trim() == "openai-chat" && trimmed.contains("/step_plan") && !trimmed.contains("/step_plan/v1") {
        trimmed = trimmed.replace("/step_plan", "/step_plan/v1");
    }
    let suffixes: &[&str] = match api_protocol.trim() {
        "anthropic-messages" => &["/v1/messages", "/messages"],
        "openai-responses" => &["/responses"],
        _ => &["/chat/completions", "/responses"],
    };
    let base = suffixes
        .iter()
        .find_map(|suffix| trimmed.strip_suffix(suffix))
        .unwrap_or(&trimmed)
        .trim_end_matches('/')
        .to_string();
    (!base.is_empty()).then_some(base)
}

pub fn record_turn_usage(
    app: &AppHandle,
    model: &str,
    prompt: &str,
    turn: &KernelTurnResponse,
    latency_ms: u64,
    project: Option<(&str, &str, Option<&str>)>,
) {
    let prompt_tokens = turn
        .get_input_tokens()
        .map(|n| n as usize)
        .unwrap_or_else(|| crate::tokens::estimate_tokens(prompt));
    let completion_tokens = turn
        .get_output_tokens()
        .map(|n| n as usize)
        .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
    let project_ctx = project.map(|(id, name, _)| (id, name));
    crate::tokens::record_usage(app, model, prompt_tokens, completion_tokens, latency_ms, project_ctx);
}

pub fn kernel_unavailable_message(profiles: &[AiProfile], kernel_detail: Option<&str>) -> String {
    let protocol = profiles
        .first()
        .map(|p| p.api_protocol.trim())
        .unwrap_or("");
    if !matches!(
        protocol,
        "" | "openai-chat" | "anthropic-messages" | "openai-responses"
    ) {
        return format!(
            "该 Provider 的 API 协议 {protocol} 没有对应的内核适配器，请在设置中改用 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages"
        );
    }
    match kernel_detail {
        Some(detail) => format!("内核运行时不可用：{detail}"),
        None => "内核运行时未就绪，请检查安装后重启 Atrium".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::kernel_base_url;

    #[test]
    fn reduces_endpoint_to_the_roots_the_kernel_rebuilds() {
        for (endpoint, expected) in [
            (
                "https://api.deepseek.com/anthropic/v1/messages",
                "https://api.deepseek.com/anthropic",
            ),
            (
                "https://api.deepseek.com/anthropic",
                "https://api.deepseek.com/anthropic",
            ),
            ("https://gateway.example/v1", "https://gateway.example/v1"),
            (
                "https://gateway.example/tenant/v1/messages",
                "https://gateway.example/tenant",
            ),
            (
                "https://gateway.example/anthropic/",
                "https://gateway.example/anthropic",
            ),
        ] {
            assert_eq!(
                kernel_base_url(endpoint, "anthropic-messages").as_deref(),
                Some(expected),
                "anthropic: {endpoint}"
            );
        }

        for (endpoint, expected) in [
            ("https://host/v1/chat/completions", "https://host/v1"),
            ("https://host/v1", "https://host/v1"),
            ("https://host/v1/messages", "https://host/v1/messages"),
        ] {
            assert_eq!(
                kernel_base_url(endpoint, "openai-chat").as_deref(),
                Some(expected),
                "openai-chat: {endpoint}"
            );
        }
    }

    #[test]
    fn bare_and_suffix_only_endpoints() {
        assert_eq!(
            kernel_base_url("https://host/v1/", "openai-chat").as_deref(),
            Some("https://host/v1")
        );
        assert_eq!(kernel_base_url("  ", "openai-chat"), None);
        assert_eq!(kernel_base_url("", "anthropic-messages"), None);
        assert_eq!(kernel_base_url("/v1/messages", "anthropic-messages"), None);
    }
}
