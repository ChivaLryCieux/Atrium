use reqwest::Client;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::models::{AiProfile, ChatMessage, OrchestrationProgress};
use super::common::{kernel_base_url, latest_user_input, record_turn_usage};
use super::transport::{post_turn, KernelTurnRequest};

/// Compose the persona/soul seed prefix for a fresh kernel session. The
/// operator input itself is NOT part of the seed — the bridge concatenates
/// seed + prompt when (and only when) it spawns a fresh session, so continuing
/// sessions are never re-seeded and evicted sessions are always re-seeded.
pub fn single_seed_context(soul: Option<&str>, system_prompt: &str) -> Option<String> {
    let mut seed = String::new();
    if let Some(s) = soul.map(str::trim).filter(|s| !s.is_empty()) {
        seed.push_str(&format!("[人格设定]\n{s}\n\n"));
    }
    let trimmed_persona = system_prompt.trim();
    if !trimmed_persona.is_empty() {
        seed.push_str(&format!("[算子准则]\n{trimmed_persona}\n\n"));
    }
    if seed.is_empty() {
        return None;
    }
    seed.push_str("[操作员输入]\n");
    Some(seed)
}

pub async fn execute_single_kernel(
    app: &AppHandle,
    http: &Client,
    daemon_url: &str,
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
    let user_input = latest_user_input(base_messages);
    let workspace = project.and_then(|(_, _, dir)| dir.map(str::to_string));
    let seed_context = single_seed_context(soul, &profile.system_prompt);
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
        prompt: user_input.clone(),
        seed_context,
    };

    let start_time = std::time::Instant::now();
    match post_turn(app, http, daemon_url, &request, std::time::Duration::from_secs(600)).await {
        Ok(turn) => {
            let latency = start_time.elapsed().as_millis() as u64;
            record_turn_usage(
                app,
                &profile.model,
                &request.prompt,
                &turn,
                latency,
                project,
            );

            let prompt_tokens = turn
                .get_input_tokens()
                .map(|n| n as usize)
                .unwrap_or_else(|| crate::tokens::estimate_tokens(&request.prompt));
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
