use reqwest::Client;

use crate::models::OpenAiErrorResponse;

const HTTP_TIMEOUT_SECS: u64 = 120;

/// Build a shared reqwest client used across the application.
pub fn build_http_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .expect("failed to create HTTP client")
}

/// Anthropic Messages API constants.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Ensure the endpoint carries the given protocol suffix (idempotent).
fn normalize_endpoint_with_suffix(input: &str, suffix: &str) -> String {
    let endpoint = input.trim().trim_end_matches('/');
    if endpoint.is_empty() || endpoint.ends_with(suffix) {
        return endpoint.to_string();
    }
    format!("{endpoint}{suffix}")
}

/// The inference endpoint a protocol's requests actually go to.
///
/// The settings form persists a complete endpoint, but a hand-typed base URL
/// carries no protocol suffix, and a caller that builds its own request — the
/// connection probe — has to resolve one the same way the senders do.
pub fn inference_endpoint(endpoint: &str, protocol: &str) -> String {
    match protocol.trim() {
        "anthropic-messages" => normalize_endpoint_with_suffix(endpoint, "/v1/messages"),
        "openai-responses" => normalize_endpoint_with_suffix(endpoint, "/responses"),
        _ => normalize_endpoint_with_suffix(endpoint, "/chat/completions"),
    }
}

/// The provider's own error text, when it sent one. The probe shows this
/// verbatim: "model_not_found" or "unsupported_value" tells the user which
/// field to fix, which a bare status code never does.
pub fn readable_error_body(body: &str) -> String {
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
