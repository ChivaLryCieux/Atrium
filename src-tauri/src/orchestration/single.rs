use reqwest::Client;
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::models::{AiProfile, ChatMessage, OrchestrationProgress};
use super::common::{kernel_base_url, latest_user_input, record_turn_usage};
use super::transport::{post_turn, KernelTurnRequest};

static SINGLE_ROUTE_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

pub fn single_route_cache() -> &'static Mutex<HashMap<String, String>> {
    SINGLE_ROUTE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const SINGLE_ROUTE_CACHE_CAP: usize = 512;

pub fn reset_single_route_cache() {
    if let Some(cache) = SINGLE_ROUTE_CACHE.get() {
        cache.blocking_lock().clear();
    }
}

pub fn has_settled_assistant(messages: &[ChatMessage]) -> bool {
    messages
        .iter()
        .any(|m| m.role == "assistant" && !m.pending && !m.error)
}

pub fn single_route_fingerprint(
    profile: &AiProfile,
    reasoning_effort: Option<&str>,
    workspace: Option<&str>,
) -> String {
    format!(
        "deepseek-official|{}|{}|{}|{}|{}|{}",
        profile.api_protocol.trim(),
        profile.model.trim(),
        reasoning_effort.unwrap_or_default().trim(),
        profile.api_key.trim(),
        kernel_base_url(&profile.endpoint, &profile.api_protocol).unwrap_or_default(),
        workspace.unwrap_or_default().trim(),
    )
}

pub fn single_kernel_prompt(
    user_input: &str,
    soul: Option<&str>,
    system_prompt: &str,
    seed: bool,
) -> String {
    if !seed {
        return user_input.to_string();
    }
    let mut prompt = String::new();
    if let Some(s) = soul.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str(&format!("[人格设定]\n{s}\n\n"));
    }
    let trimmed_persona = system_prompt.trim();
    if !trimmed_persona.is_empty() {
        prompt.push_str(&format!("[算子准则]\n{trimmed_persona}\n\n"));
    }
    prompt.push_str(&format!("[操作员输入]\n{user_input}"));
    prompt
}

pub async fn execute_single_kernel(
    app: &AppHandle,
    http: &Client,
    profiles: &[AiProfile],
    base_messages: &[ChatMessage],
    conversation: &str,
    reasoning_effort: Option<String>,
    execution_mode: Option<String>,
    project: Option<(&str, &str, Option<&str>)>,
    soul: Option<&str>,
) -> Vec<ChatMessage> {
    let Some(profile) = profiles.first() else {
        return vec![];
    };
    let daemon_url = "http://127.0.0.1:19387";
    let user_input = latest_user_input(base_messages);
    let workspace = project.and_then(|(_, _, dir)| dir.map(str::to_string));
    let fingerprint = single_route_fingerprint(
        profile,
        reasoning_effort.as_deref(),
        workspace.as_deref(),
    );

    let settled = has_settled_assistant(base_messages);
    let rerouted = single_route_cache()
        .lock()
        .await
        .get(conversation)
        .map(|seeded| seeded != &fingerprint)
        .unwrap_or(settled);
    let seed = !settled || rerouted;
    let prompt = single_kernel_prompt(&user_input, soul, &profile.system_prompt, seed);
    let stage_id = format!("{}-single", profile.id);

    let _ = app.emit(
        "orchestration-progress",
        OrchestrationProgress {
            stage_id: stage_id.clone(),
            stage_title: profile.name.clone(),
            profile_name: profile.name.clone(),
            status: "running".to_string(),
            content: None,
            message_id: None,
        },
    );

    let request = KernelTurnRequest {
        conversation_id: conversation.to_string(),
        stage_id: Some(stage_id.clone()),
        provider: "deepseek-official".to_string(),
        model: profile.model.clone(),
        api_key: profile.api_key.clone(),
        api_protocol: Some(profile.api_protocol.trim().to_string()),
        base_url: kernel_base_url(&profile.endpoint, &profile.api_protocol),
        reasoning_effort,
        workspace,
        execution_mode,
        prompt: prompt.clone(),
    };

    let start_time = std::time::Instant::now();
    match post_turn(app, http, daemon_url, &request, std::time::Duration::from_secs(600)).await {
        Ok(turn) => {
            let latency = start_time.elapsed().as_millis() as u64;
            record_turn_usage(
                app,
                &profile.model,
                &prompt,
                &turn,
                latency,
                project,
            );

            if seed {
                let mut cache = single_route_cache().lock().await;
                if cache.len() >= SINGLE_ROUTE_CACHE_CAP {
                    cache.clear();
                }
                cache.insert(conversation.to_string(), fingerprint);
            }
            let prompt_tokens = turn
                .get_input_tokens()
                .map(|n| n as usize)
                .unwrap_or_else(|| crate::tokens::estimate_tokens(&prompt));
            let completion_tokens = turn
                .get_output_tokens()
                .map(|n| n as usize)
                .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
            let has_content = !turn.final_response.trim().is_empty();
            let has_reasoning = turn.reasoning_content.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
            let has_tools = turn.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
            let is_empty = !has_content && !has_reasoning && !has_tools;
            let display_content = if is_empty {
                "模型未返回有效回复内容（请检查端点地址、API Key 与网络状态）。".to_string()
            } else {
                turn.final_response.clone()
            };
            let reply = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content: display_content,
                speaker_id: Some(profile.id.clone()),
                speaker_name: profile.name.clone(),
                avatar: profile.avatar.clone(),
                pending: false,
                error: is_empty,
                paused: turn.kernel_route.as_deref() == Some("aborted"),
                prompt_tokens: Some(prompt_tokens),
                completion_tokens: Some(completion_tokens),
                latency_ms: Some(latency),
                tool_calls: turn.tool_calls,
                reasoning_content: turn.reasoning_content,
                reasoning_duration_ms: None,
            };
            let _ = app.emit(
                "orchestration-progress",
                OrchestrationProgress {
                    stage_id: stage_id.clone(),
                    stage_title: profile.name.clone(),
                    profile_name: profile.name.clone(),
                    status: "completed".to_string(),
                    content: Some(reply.content.clone()),
                    message_id: Some(reply.id.clone()),
                },
            );
            vec![reply]
        }
        Err(err) => {
            let reply = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content: err.clone(),
                speaker_id: Some(profile.id.clone()),
                speaker_name: profile.name.clone(),
                avatar: profile.avatar.clone(),
                pending: false,
                error: true,
                paused: false,
                prompt_tokens: None,
                completion_tokens: None,
                latency_ms: Some(start_time.elapsed().as_millis() as u64),
                tool_calls: None,
                reasoning_content: None,
                reasoning_duration_ms: None,
            };
            let _ = app.emit(
                "orchestration-progress",
                OrchestrationProgress {
                    stage_id: stage_id.clone(),
                    stage_title: profile.name.clone(),
                    profile_name: profile.name.clone(),
                    status: "error".to_string(),
                    content: Some(err),
                    message_id: Some(reply.id.clone()),
                },
            );
            vec![reply]
        }
    }
}
