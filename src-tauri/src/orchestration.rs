use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ai_client::send_chat;
use crate::daemon::DshDaemon;
use crate::messages::to_api_messages;
use crate::models::{
    AiProfile, ChatMessage, OrchestrationProgress, OrchestrationStage,
};

// ─── Stage templates ───────────────────────────────────────────

struct StageTemplate {
    title: &'static str,
    role: &'static str,
    instruction: &'static str,
}

const ROLE_TEMPLATES: &[StageTemplate] = &[
    StageTemplate {
        title: "Node-01 // 探针解析",
        role: "探针解析算子 (Probe)",
        instruction: "你是装具流水线中的 Node-01 探针节点。请对输入的目标指令或技术问题进行首轮结构化拆解与直接回应，优先明确关键结论、核心论据与执行基线。不评述装具内部机制。",
    },
    StageTemplate {
        title: "Node-02 // 深度拓展",
        role: "拓展综合算子 (Synthesis)",
        instruction: "你是装具流水线中的 Node-02 综合节点。请基于目标问题与前序 Node-01 的分析结果进行纵深拓展，补齐架构背景、技术边界、边缘条件与可执行实现细节。避免低效重复。",
    },
    StageTemplate {
        title: "Node-03 // 审校评判",
        role: "评判校验算子 (Critique)",
        instruction: "你是装具流水线中的 Node-03 校验节点。请客观审校前序各节点的输出，指出潜在的逻辑漏洞、安全性隐患与实现风险，收敛分歧并输出高可信度的终极工程建议。",
    },
];

const SPECIALIST_TEMPLATE: StageTemplate = StageTemplate {
    title: "", // computed at runtime
    role: "专项处理算子 (Specialist)",
    instruction: "你是装具流水线中的专项扩展节点。请结合前序算子输出，针对专精维度提供增量技术洞察与补充推演。",
};

// ─── Public API ────────────────────────────────────────────────

/// Build orchestration stages from the selected profiles.
pub fn build_stages(profiles: &[AiProfile]) -> Vec<OrchestrationStage> {
    profiles
        .iter()
        .enumerate()
        .map(|(index, profile)| {
            let template = ROLE_TEMPLATES
                .get(index)
                .unwrap_or(&SPECIALIST_TEMPLATE);

            let title = if index < ROLE_TEMPLATES.len() {
                template.title.to_string()
            } else {
                format!("Node-{:02} // 专项算子", index + 1)
            };

            let depends_on = if index == 0 {
                vec![]
            } else {
                vec![format!("{}-{}", profiles[index - 1].id, index - 1)]
            };

            OrchestrationStage {
                id: format!("{}-{}", profile.id, index),
                title,
                role: template.role.to_string(),
                instruction: template.instruction.to_string(),
                profile: profile.clone(),
                depends_on,
            }
        })
        .collect()
}

/// Append orchestration instructions to a profile's system prompt.
pub fn with_stage_instruction(profile: &AiProfile, stage: &OrchestrationStage) -> AiProfile {
    let base_prompt = profile.system_prompt.trim();
    let orchestration_prompt = format!(
        "[ATRIUM_HARNESS_DISPATCH]\n\
         - 当前流水线节点: {}\n\
         - 算子角色: {}\n\
         - 调度执行指令: {}\n\
         - 准则: 保持冷静、理性、高度结构化与工业级严谨，直接输出工程与技术解析，不暴露底座实现细节。",
        stage.title, stage.role, stage.instruction,
    );

    let system_prompt = if base_prompt.is_empty() {
        orchestration_prompt
    } else {
        format!("{base_prompt}\n\n{orchestration_prompt}")
    };

    AiProfile {
        system_prompt,
        ..profile.clone()
    }
}

/// Execute the full orchestration pipeline and return the final message list.
///
/// Preferred route: the Atrium kernel bridge (`@atrium/desktop-host`) driving a
/// real DeepSeek Harness runtime — one kernel session per conversation, so
/// multi-turn context is owned by the kernel and replies stream to the UI
/// over its WebSocket.
///
/// Fallback route: direct OpenAI-compatible HTTP calls, used when the kernel
/// bridge is unavailable (no Node, kernel not built, port probe failed).
pub async fn execute(
    app: &AppHandle,
    http: &Client,
    kernel_http: &Client,
    daemon: &Mutex<DshDaemon>,
    profiles: &[AiProfile],
    base_messages: &[ChatMessage],
    mode: &str,
    conversation_id: Option<String>,
    reasoning_effort: Option<String>,
    execution_mode: Option<String>,
    project: Option<(&str, &str, Option<&str>)>,
    soul: Option<&str>,
) -> Vec<ChatMessage> {
    // Only kernel-recognized modes pass through; anything else uses the
    // runtime's shipped default (workspace-write + ask).
    let execution_mode = execution_mode
        .as_deref()
        .filter(|m| matches!(*m, "plan" | "ask" | "auto"))
        .map(str::to_string);

    // The kernel's deepseek-official provider speaks the OpenAI-compatible
    // wire protocol only; other protocols stay on the direct route, which
    // implements them natively (Anthropic Messages / OpenAI Responses).
    let kernel_compatible = profiles
        .first()
        .map(|p| {
            let protocol = p.api_protocol.trim();
            protocol.is_empty() || protocol == "openai-chat"
        })
        .unwrap_or(false);

    let kernel_ready = if !kernel_compatible {
        false
    } else {
        let mut guard = daemon.lock().await;
        if !guard.kernel_available() {
            // One late start attempt: the frontend may not have finished
            // initializing the bridge when the first message arrives.
            let _ = guard.start(http, app).await;
        }
        guard.kernel_available()
    };

    if kernel_ready {
        let conversation = conversation_id.unwrap_or_else(|| format!("adhoc-{}", Uuid::new_v4()));
        if mode == "parallel" {
            execute_parallel_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await
        } else {
            execute_dag_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await
        }
    } else if mode == "parallel" {
        execute_parallel(http, profiles, base_messages, project, soul).await
    } else {
        execute_dag(app, http, profiles, base_messages, project, soul).await
    }
}

// ─── Kernel route (DeepSeek Harness runtime) ───────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KernelTurnRequest {
    conversation_id: String,
    stage_id: Option<String>,
    provider: String,
    model: String,
    api_key: String,
    /// Bare base URL for the kernel provider (DEEPSEEK_BASE_URL); the kernel
    /// appends `/chat/completions` itself, so full endpoints are reduced.
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    /// Kernel process cwd for this turn (the project's default directory).
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace: Option<String>,
    /// Execution mode: plan | ask | auto (DSH_PERMISSION_MODE in the runtime).
    #[serde(skip_serializing_if = "Option::is_none")]
    execution_mode: Option<String>,
    prompt: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct KernelTurnResponse {
    #[serde(default)]
    #[allow(dead_code)]
    session_id: String,
    #[serde(default)]
    final_response: String,
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
}

async fn post_turn(
    http: &Client,
    daemon_url: &str,
    request: &KernelTurnRequest,
    timeout: std::time::Duration,
) -> Result<KernelTurnResponse, String> {
    let url = format!("{daemon_url}/v1/turn");
    let future = http.post(&url).json(request).send();
    let response = tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| "节点执行超时（内核熔断保护）".to_string())?
        .map_err(|e| format!("内核桥接请求失败: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
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

    serde_json::from_str(&body).map_err(|e| format!("内核响应解析失败: {e}"))
}

fn latest_user_input(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default()
}

/// Reduce a user-configured chat endpoint to the bare base URL the kernel
/// provider expects: it appends `/chat/completions` itself, so a stored
/// endpoint of `https://host/v1/chat/completions` must become
/// `https://host/v1`, while already-bare entries pass through unchanged.
fn normalize_base_url(endpoint: &str) -> Option<String> {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let base = trimmed
        .strip_suffix("/chat/completions")
        .or_else(|| trimmed.strip_suffix("/responses"))
        .unwrap_or(trimmed)
        .trim_end_matches('/')
        .to_string();
    (!base.is_empty()).then_some(base)
}

fn kernel_stage_prompt(stage: &OrchestrationStage, index: usize, user_input: &str, soul: Option<&str>) -> String {
    let persona = stage.profile.system_prompt.trim();
    let mut prompt = String::new();
    if index == 0 {
        if let Some(soul) = soul.map(str::trim).filter(|s| !s.is_empty()) {
            prompt.push_str(&format!("[人格设定]\n{soul}\n\n"));
        }
        if !persona.is_empty() {
            prompt.push_str(&format!("[算子准则]\n{persona}\n\n"));
        }
        prompt.push_str(&format!(
            "[节点指令] {}\n\n[操作员输入]\n{}",
            stage.instruction, user_input
        ));
    } else {
        prompt.push_str(&format!(
            "[节点指令] {}\n\n（前序节点输出已在本会话上下文中，请基于其继续推进。）",
            stage.instruction
        ));
    }
    prompt
}

fn stage_message_id(stage: &OrchestrationStage) -> String {
    // Stable id shared with the frontend pending bubble, so streamed deltas
    // and the settled reply render into the same node.
    stage.id.clone()
}

async fn execute_dag_kernel(
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
            base_url: normalize_base_url(&stage.profile.endpoint),
            reasoning_effort: reasoning_effort.clone(),
            workspace: workspace.clone(),
            execution_mode: execution_mode.clone(),
            prompt: kernel_stage_prompt(stage, index, &user_input, soul),
        };

        let start_time = std::time::Instant::now();
        match post_turn(http, daemon_url, &request, std::time::Duration::from_secs(600)).await {
            Ok(turn) => {
                let latency = start_time.elapsed().as_millis() as u64;
                record_turn_usage(app, stage.profile.model.trim(), &request.prompt, &turn, latency, project);

                let reply = ChatMessage {
                    id: stage_message_id(stage),
                    role: "assistant".to_string(),
                    content: turn.final_response,
                    speaker_id: Some(stage.profile.id.clone()),
                    speaker_name: format!("{} · {}", stage.title, stage.profile.name),
                    avatar: stage.profile.avatar.clone(),
                    pending: false,
                    error: false,
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
                    id: stage_message_id(stage),
                    role: "assistant".to_string(),
                    content: err.clone(),
                    speaker_id: Some(stage.profile.id.clone()),
                    speaker_name: format!("{} · {}", stage.title, stage.profile.name),
                    avatar: stage.profile.avatar.clone(),
                    pending: false,
                    error: true,
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
                // A kernel failure (credential, route, transport) will repeat
                // identically on every later stage — stop the pipeline here.
                break;
            }
        }
    }

    completed_replies
}

/// Feed one settled kernel turn into the token meter. Kernel-reported usage
/// wins; absent numbers fall back to the local estimator.
fn record_turn_usage(
    app: &AppHandle,
    model: &str,
    prompt: &str,
    turn: &KernelTurnResponse,
    latency_ms: u64,
    project: Option<(&str, &str, Option<&str>)>,
) {
    let prompt_tokens = turn
        .input_tokens
        .map(|n| n as usize)
        .unwrap_or_else(|| crate::tokens::estimate_tokens(prompt));
    let completion_tokens = turn
        .output_tokens
        .map(|n| n as usize)
        .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
    let project_ctx = project.map(|(id, name, _)| (id, name));
    crate::tokens::record_usage(app, model, prompt_tokens, completion_tokens, latency_ms, project_ctx);
}

async fn execute_parallel_kernel(
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
    let daemon_url = "http://127.0.0.1:19387";
    let user_input = latest_user_input(base_messages);
    let workspace = project.and_then(|(_, _, dir)| dir.map(str::to_string));
    let soul_block = soul.map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("[人格设定]\n{s}\n\n", s = s));

    let futures = profiles.iter().enumerate().map(|(index, profile)| {
        let conversation = format!("{conversation}::parallel-{index}");
        let persona = profile.system_prompt.trim();
        let persona_block = if persona.is_empty() { String::new() } else { format!("[算子准则]\n{persona}\n\n") };
        let prompt = format!("{}{}[操作员输入]\n{}", soul_block.clone().unwrap_or_default(), persona_block, user_input);
        let request = KernelTurnRequest {
            conversation_id: conversation,
            stage_id: Some(format!("{}-{}", profile.id, index)),
            provider: "deepseek-official".to_string(),
            model: profile.model.clone(),
            api_key: profile.api_key.clone(),
            base_url: normalize_base_url(&profile.endpoint),
            reasoning_effort: reasoning_effort.clone(),
            workspace: workspace.clone(),
            execution_mode: execution_mode.clone(),
            prompt: prompt.clone(),
        };
        async move {
            let start_time = std::time::Instant::now();
            let result = post_turn(http, daemon_url, &request, std::time::Duration::from_secs(600)).await;
            (profile, prompt, start_time, result)
        }
    });

    let results = futures::future::join_all(futures).await;

    results
        .into_iter()
        .map(|(profile, prompt, start_time, result)| {
            let (content, error) = match result {
                Ok(turn) => {
                    let latency = start_time.elapsed().as_millis() as u64;
                    record_turn_usage(app, profile.model.trim(), &prompt, &turn, latency, project);
                    (turn.final_response, false)
                }
                Err(err) => (err, true),
            };
            ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content,
                speaker_id: Some(profile.id.clone()),
                speaker_name: profile.name.clone(),
                avatar: profile.avatar.clone(),
                pending: false,
                error,
            }
        })
        .collect()
}

// ─── Direct route (fallback, no kernel) ────────────────────────

async fn execute_dag(
    app: &AppHandle,
    http: &Client,
    profiles: &[AiProfile],
    base_messages: &[ChatMessage],
    project: Option<(&str, &str, Option<&str>)>,
    soul: Option<&str>,
) -> Vec<ChatMessage> {
    let stages = build_stages(profiles);
    let mut completed_replies: Vec<ChatMessage> = Vec::new();

    for stage in &stages {
        let message_id = Uuid::new_v4().to_string();

        // Emit "running" progress
        let _ = app.emit(
            "orchestration-progress",
            OrchestrationProgress {
                stage_id: stage.id.clone(),
                stage_title: stage.title.clone(),
                profile_name: stage.profile.name.clone(),
                status: "running".to_string(),
                content: Some(format!("{} 正在处理...", stage.title)),
                message_id: Some(message_id.clone()),
            },
        );

        // Build context: base messages + all completed replies so far
        let mut context: Vec<ChatMessage> = base_messages.to_vec();
        context.extend(completed_replies.clone());

        let soul_seeded_profile = match soul.map(str::trim).filter(|s| !s.is_empty()) {
            Some(soul) => AiProfile {
                system_prompt: format!("[人格设定]\n{soul}\n\n{}", stage.profile.system_prompt.trim()),
                ..stage.profile.clone()
            },
            None => stage.profile.clone(),
        };
        let augmented_profile = with_stage_instruction(&soul_seeded_profile, stage);
        let api_messages = to_api_messages(&context, Some(&augmented_profile));
        let start_time = std::time::Instant::now();
        let prompt_tokens = context.iter().map(|m| crate::tokens::estimate_tokens(&m.content)).sum::<usize>();

        let timeout_fut = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            send_chat(http, &augmented_profile, &api_messages),
        );

        let result = match timeout_fut.await {
            Ok(inner_res) => inner_res,
            Err(_) => Err(anyhow::anyhow!("节点执行超时 (60s 熔断保护)")),
        };

        let latency = start_time.elapsed().as_millis() as u64;

        match result {
            Ok(response) => {
                let completion_tokens = crate::tokens::estimate_tokens(&response.content);
                crate::tokens::record_usage(
                    app,
                    &stage.profile.model,
                    prompt_tokens,
                    completion_tokens,
                    latency,
                    project.map(|(id, name, _)| (id, name)),
                );

                let reply = ChatMessage {
                    id: message_id,
                    role: "assistant".to_string(),
                    content: response.content,
                    speaker_id: Some(stage.profile.id.clone()),
                    speaker_name: format!("{} · {}", stage.title, stage.profile.name),
                    avatar: stage.profile.avatar.clone(),
                    pending: false,
                    error: false,
                };
                completed_replies.push(reply.clone());

                let _ = app.emit(
                    "orchestration-progress",
                    OrchestrationProgress {
                        stage_id: stage.id.clone(),
                        stage_title: stage.title.clone(),
                        profile_name: stage.profile.name.clone(),
                        status: "completed".to_string(),
                        content: Some(reply.content),
                        message_id: Some(reply.id),
                    },
                );
            }
            Err(err) => {
                let reply = ChatMessage {
                    id: message_id,
                    role: "assistant".to_string(),
                    content: err.to_string(),
                    speaker_id: Some(stage.profile.id.clone()),
                    speaker_name: format!("{} · {}", stage.title, stage.profile.name),
                    avatar: stage.profile.avatar.clone(),
                    pending: false,
                    error: true,
                };
                completed_replies.push(reply.clone());

                let _ = app.emit(
                    "orchestration-progress",
                    OrchestrationProgress {
                        stage_id: stage.id.clone(),
                        stage_title: stage.title.clone(),
                        profile_name: stage.profile.name.clone(),
                        status: "error".to_string(),
                        content: Some(err.to_string()),
                        message_id: Some(reply.id),
                    },
                );
            }
        }
    }

    completed_replies
}

async fn execute_parallel(
    http: &Client,
    profiles: &[AiProfile],
    base_messages: &[ChatMessage],
    _project: Option<(&str, &str, Option<&str>)>,
    soul: Option<&str>,
) -> Vec<ChatMessage> {
    let soul_seeded: Vec<AiProfile> = profiles
        .iter()
        .map(|profile| match soul.map(str::trim).filter(|s| !s.is_empty()) {
            Some(soul) => AiProfile {
                system_prompt: format!("[人格设定]\n{soul}\n\n{}", profile.system_prompt.trim()),
                ..profile.clone()
            },
            None => profile.clone(),
        })
        .collect();

    let api_messages_per_profile: Vec<_> = soul_seeded
        .iter()
        .map(|p| to_api_messages(base_messages, Some(p)))
        .collect();

    let futures: Vec<_> = soul_seeded
        .iter()
        .zip(api_messages_per_profile.iter())
        .map(|(profile, api_msgs)| async move {
            let result = send_chat(http, profile, api_msgs).await;
            (profile, result)
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    results
        .into_iter()
        .map(|(profile, result)| {
            let message_id = Uuid::new_v4().to_string();
            match result {
                Ok(response) => ChatMessage {
                    id: message_id,
                    role: "assistant".to_string(),
                    content: response.content,
                    speaker_id: Some(profile.id.clone()),
                    speaker_name: profile.name.clone(),
                    avatar: profile.avatar.clone(),
                    pending: false,
                    error: false,
                },
                Err(err) => ChatMessage {
                    id: message_id,
                    role: "assistant".to_string(),
                    content: err.to_string(),
                    speaker_id: Some(profile.id.clone()),
                    speaker_name: profile.name.clone(),
                    avatar: profile.avatar.clone(),
                    pending: false,
                    error: true,
                },
            }
        })
        .collect()
}
