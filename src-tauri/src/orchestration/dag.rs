use reqwest::Client;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::models::{AiProfile, ChatMessage, OrchestrationProgress};
use super::common::{kernel_base_url, latest_user_input, record_turn_usage};
use super::stages::{build_stages, kernel_stage_prompt, stage_message_id};
use super::transport::{post_turn, KernelTurnRequest};

pub async fn execute_dag_kernel(
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
    let stages = build_stages(profiles);
    let daemon_url = "http://127.0.0.1:19387";
    let user_input = latest_user_input(base_messages);
    let workspace = project.and_then(|(_, _, dir)| dir.map(str::to_string));
    let mut completed_replies: Vec<ChatMessage> = Vec::new();

    for (index, stage) in stages.iter().enumerate() {
        let _ = app.emit(
            "orchestration-progress",
            OrchestrationProgress {
                stage_id: stage.id.clone(),
                stage_title: stage.title.clone(),
                profile_name: stage.profile.name.clone(),
                status: "running".to_string(),
                content: Some(format!("{} 正在处理...", stage.title)),
                message_id: Some(stage_message_id(stage)),
            },
        );

        let request = KernelTurnRequest {
            conversation_id: conversation.to_string(),
            stage_id: Some(stage.id.clone()),
            provider: "deepseek-official".to_string(),
            model: stage.profile.model.clone(),
            api_key: stage.profile.api_key.clone(),
            api_protocol: Some(stage.profile.api_protocol.trim().to_string()),
            base_url: kernel_base_url(&stage.profile.endpoint, &stage.profile.api_protocol),
            reasoning_effort: reasoning_effort.clone(),
            workspace: workspace.clone(),
            execution_mode: execution_mode.clone(),
            prompt: kernel_stage_prompt(stage, index, &user_input, soul),
        };

        let start_time = std::time::Instant::now();
        match post_turn(app, http, daemon_url, &request, std::time::Duration::from_secs(600)).await {
            Ok(turn) => {
                let latency = start_time.elapsed().as_millis() as u64;
                record_turn_usage(app, stage.profile.model.trim(), &request.prompt, &turn, latency, project);

                let prompt_tokens = turn
                    .get_input_tokens()
                    .map(|n| n as usize)
                    .unwrap_or_else(|| crate::tokens::estimate_tokens(&request.prompt));
                let completion_tokens = turn
                    .get_output_tokens()
                    .map(|n| n as usize)
                    .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
                let reply = ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "assistant".to_string(),
                    content: turn.final_response,
                    speaker_id: Some(stage.profile.id.clone()),
                    speaker_name: format!("{} · {}", stage.title, stage.profile.name),
                    avatar: stage.profile.avatar.clone(),
                    pending: false,
                    error: false,
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
                        stage_id: stage.id.clone(),
                        stage_title: stage.title.clone(),
                        profile_name: stage.profile.name.clone(),
                        status: "completed".to_string(),
                        content: Some(reply.content.clone()),
                        message_id: Some(reply.id.clone()),
                    },
                );
                completed_replies.push(reply);
            }
            Err(err) => {
                let reply = ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "assistant".to_string(),
                    content: err.clone(),
                    speaker_id: Some(stage.profile.id.clone()),
                    speaker_name: format!("{} · {}", stage.title, stage.profile.name),
                    avatar: stage.profile.avatar.clone(),
                    pending: false,
                    error: true,
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
                        stage_id: stage.id.clone(),
                        stage_title: stage.title.clone(),
                        profile_name: stage.profile.name.clone(),
                        status: "error".to_string(),
                        content: Some(err),
                        message_id: Some(reply.id.clone()),
                    },
                );
                completed_replies.push(reply);
                break;
            }
        }
    }

    completed_replies
}
