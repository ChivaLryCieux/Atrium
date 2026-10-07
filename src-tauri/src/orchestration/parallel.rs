use reqwest::Client;
use tauri::AppHandle;
use uuid::Uuid;

use crate::models::{AiProfile, ChatMessage};
use super::common::{kernel_base_url, latest_user_input, record_turn_usage};
use super::transport::{post_turn, KernelTurnRequest};

pub async fn execute_parallel_kernel(
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
    let user_input = latest_user_input(base_messages);
    let workspace = project.and_then(|(_, _, dir)| dir.map(str::to_string));
    let soul_block = soul.map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("[人格设定]\n{s}\n\n"));

    let futures = profiles.iter().enumerate().map(|(index, profile)| {
        let conversation = format!("{conversation}::parallel-{index}");
        let persona = profile.system_prompt.trim();
        let persona_block = if persona.is_empty() {
            String::new()
        } else {
            format!("[算子准则]\n{persona}\n\n")
        };
        let prompt = format!("{}{}[操作员输入]\n{}", soul_block.clone().unwrap_or_default(), persona_block, user_input);
        let request = KernelTurnRequest {
            conversation_id: conversation,
            stage_id: Some(format!("{}-{}", profile.id, index)),
            provider: "deepseek-official".to_string(),
            model: profile.model.clone(),
            api_key: profile.api_key.clone(),
            api_protocol: Some(profile.api_protocol.trim().to_string()),
            base_url: kernel_base_url(&profile.endpoint, &profile.api_protocol),
            reasoning_effort: reasoning_effort.clone(),
            workspace: workspace.clone(),
            execution_mode: execution_mode.clone(),
            prompt: prompt.clone(),
        };
        async move {
            let start_time = std::time::Instant::now();
            let result = post_turn(app, http, daemon_url, &request, std::time::Duration::from_secs(600)).await;
            (profile, prompt, start_time, result)
        }
    });

    let results = futures::future::join_all(futures).await;

    results
        .into_iter()
        .enumerate()
        .map(|(_index, (profile, prompt, start_time, result))| {
            let latency = start_time.elapsed().as_millis() as u64;
            match result {
                Ok(turn) => {
                    record_turn_usage(app, profile.model.trim(), &prompt, &turn, latency, project);
                    let prompt_tokens = turn
                        .get_input_tokens()
                        .map(|n| n as usize)
                        .unwrap_or_else(|| crate::tokens::estimate_tokens(&prompt));
                    let completion_tokens = turn
                        .get_output_tokens()
                        .map(|n| n as usize)
                        .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
                    ChatMessage {
                        id: Uuid::new_v4().to_string(),
                        role: "assistant".to_string(),
                        content: turn.final_response,
                        speaker_id: Some(profile.id.clone()),
                        speaker_name: profile.name.clone(),
                        avatar: profile.avatar.clone(),
                        pending: false,
                        error: false,
                        paused: turn.kernel_route.as_deref() == Some("aborted"),
                        prompt_tokens: Some(prompt_tokens),
                        completion_tokens: Some(completion_tokens),
                        latency_ms: Some(latency),
                        tool_calls: turn.tool_calls,
                        reasoning_content: turn.reasoning_content,
                        reasoning_duration_ms: None,
                    }
                }
                Err(err) => ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "assistant".to_string(),
                    content: err,
                    speaker_id: Some(profile.id.clone()),
                    speaker_name: profile.name.clone(),
                    avatar: profile.avatar.clone(),
                    pending: false,
                    error: true,
                    paused: false,
                    prompt_tokens: None,
                    completion_tokens: None,
                    latency_ms: Some(latency),
                    tool_calls: None,
                    reasoning_content: None,
                    reasoning_duration_ms: None,
                },
            }
        })
        .collect()
}
