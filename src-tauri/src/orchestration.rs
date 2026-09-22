use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ai_client::send_chat;
use crate::daemon::DshDaemon;
use crate::messages::to_api_messages;
use crate::models::{
    AiProfile, ChatMessage, OrchestrationProgress, OrchestrationStage,
};

// ─── Default single-conversation engine ────────────────────────
//
// The default orchestration is a plain single dialogue (like Codex):
// one active profile answers in one kernel session. The selected
// persona (Souls/<folder>/SOUL.md) is injected as prompt text together
// with the operator's first message of each task (Session), then the
// kernel owns multi-turn context and later turns send only the new
// user input.
//
// The DAG / parallel pipelines below are kept as legacy products and
// are only used when the stored mode explicitly selects them.
//
// Route changes (model / reasoning / credential / endpoint / workspace)
// reset the kernel session on the bridge side (see routeKey in
// @atrium/desktop-host), which would silently drop the persona. To keep
// the invariant "every fresh kernel session starts with the persona",
// the Rust side remembers the route fingerprint it last seeded per
// conversation and re-injects the SOUL.md + system prompt once whenever
// the fingerprint differs. Soul switches mid-task intentionally do NOT
// re-inject: the newly selected persona takes effect on the next task.
//
// Fingerprint fields mirror the bridge routeKey exactly (provider,
// model, reasoning, credential hash, base URL, workspace): anything
// that changes the bridge runtime/session binding must change this
// fingerprint as well.

/// Remembers, per Atrium conversation, the route fingerprint that was
/// last seeded with the persona. Process-local: a restart clears it,
/// which only causes one extra seed prompt on the next turn — the safe
/// direction (missing persona is worse than a redundant one).
static SINGLE_ROUTE_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn single_route_cache() -> &'static Mutex<HashMap<String, String>> {
    SINGLE_ROUTE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Upper bound for the route cache; conversations are lightweight keys
/// and old entries are dropped opportunistically.
const SINGLE_ROUTE_CACHE_CAP: usize = 512;

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
        } else if mode == "single" {
            execute_single_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await
        } else {
            execute_dag_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await
        }
    } else if mode == "parallel" {
        execute_parallel(http, profiles, base_messages, project, soul).await
    } else if mode == "single" {
        execute_single_direct(app, http, profiles, base_messages, project, soul).await
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
    #[serde(default)]
    tool_calls: Option<Vec<crate::models::ToolCallRecord>>,
}

async fn post_turn(
    app: &AppHandle,
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

    // Check if response is SSE stream (Content-Type: text/event-stream)
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

    // Read SSE byte stream incrementally
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut final_turn: Option<KernelTurnResponse> = None;
    let mut current_event_type = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[ATRIUM_SSE] Error reading chunk: {e}");
                break;
            }
        };

        let chunk_str = match std::str::from_utf8(&chunk) {
            Ok(s) => s,
            Err(_) => continue,
        };
        buffer.push_str(chunk_str);

        // Process complete SSE messages (delimited by \n\n)
        while let Some(pos) = buffer.find("\n\n") {
            let message = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            let mut data_str = String::new();
            for line in message.lines() {
                if let Some(event_val) = line.strip_prefix("event: ") {
                    current_event_type = event_val.trim().to_string();
                } else if let Some(data_val) = line.strip_prefix("data: ") {
                    data_str = data_val.trim().to_string();
                }
            }

            if data_str.is_empty() {
                continue;
            }

            match current_event_type.as_str() {
                "stream" => {
                    // Forward raw dsh JSON payload directly to the frontend via Tauri IPC
                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        let _ = app.emit("kernel-stream-event", json_val);
                    }
                }
                "done" => {
                    if let Ok(resp) = serde_json::from_str::<KernelTurnResponse>(&data_str) {
                        final_turn = Some(resp);
                    }
                }
                "error" => {
                    if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        let msg = err_val
                            .get("error")
                            .and_then(|e| e.as_str())
                            .unwrap_or("内核内部执行错误");
                        return Err(msg.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    final_turn.ok_or_else(|| "内核流式响应提前终止，未返回结算结果".to_string())
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
        let guidance = web_access_guidance(&stage.profile.endpoint);
        if !guidance.is_empty() || !persona.is_empty() {
            prompt.push_str(&format!("[算子准则]\n{}{}\n\n", guidance, persona));
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
        match post_turn(app, http, daemon_url, &request, std::time::Duration::from_secs(600)).await {
            Ok(turn) => {
                let latency = start_time.elapsed().as_millis() as u64;
                record_turn_usage(app, stage.profile.model.trim(), &request.prompt, &turn, latency, project);

                let prompt_tokens = turn
                    .input_tokens
                    .map(|n| n as usize)
                    .unwrap_or_else(|| crate::tokens::estimate_tokens(&request.prompt));
                let completion_tokens = turn
                    .output_tokens
                    .map(|n| n as usize)
                    .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
                let reply = ChatMessage {
                    id: stage_message_id(stage),
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
                    prompt_tokens: None,
                    completion_tokens: None,
                    latency_ms: Some(start_time.elapsed().as_millis() as u64),
                    tool_calls: None,
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

/// Whether the task already holds a settled (non-pending, non-error)
/// assistant reply. Used by the single engine's seed rule.
fn has_settled_assistant(messages: &[ChatMessage]) -> bool {
    messages
        .iter()
        .any(|m| m.role == "assistant" && !m.pending && !m.error)
}

/// Route fingerprint mirroring the bridge `routeKey` (provider, model,
/// reasoning, credential, base URL, workspace). The Soul content is
/// deliberately excluded: switching persona mid-task must NOT reseed.
fn single_route_fingerprint(
    profile: &AiProfile,
    reasoning_effort: Option<&str>,
    workspace: Option<&str>,
) -> String {
    format!(
        "deepseek-official|{}|{}|{}|{}|{}",
        profile.model.trim(),
        reasoning_effort.unwrap_or_default().trim(),
        profile.api_key.trim(),
        normalize_base_url(&profile.endpoint).unwrap_or_default(),
        workspace.unwrap_or_default().trim(),
    )
}

/// Check whether an endpoint corresponds to official DeepSeek services.
fn is_official_deepseek(endpoint: &str) -> bool {
    let ep = endpoint.trim().to_lowercase();
    ep.is_empty() || ep.contains("api.deepseek.com")
}

/// Dynamic web-access instructions injected based on the provider/endpoint:
/// Official DeepSeek has native web search credentials; third-party endpoints
/// (such as StepFun, Moonshot, OpenAI proxies) lack DeepSeek web_search authentication
/// and should use web_fetch for direct page access.
fn web_access_guidance(endpoint: &str) -> &'static str {
    if is_official_deepseek(endpoint) {
        ""
    } else {
        "[网络访问准则]\n当前运行于第三方模型服务，请使用 `web_fetch` 工具抓取、阅读与分析指定网页或资讯 URL；避免调用需要 DeepSeek 官方搜索凭据的 `web_search` 工具。若需获取外部实时信息，请明确目标网址后通过 `web_fetch` 抓取。\n\n"
    }
}

/// Build the single-engine kernel prompt. On seed turns the persona
/// (SOUL.md + supplier system prompt) is prepended once as prompt text
/// ahead of the operator's first message; later turns send only the new
/// user input verbatim so the kernel session carries the context.
fn single_kernel_prompt(
    user_input: &str,
    soul: Option<&str>,
    system_prompt: &str,
    endpoint: &str,
    seed: bool,
) -> String {
    if !seed {
        return user_input.to_string();
    }
    let mut prompt = String::new();
    if let Some(s) = soul.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str(&format!("[人格设定]\n{s}\n\n"));
    }
    let guidance = web_access_guidance(endpoint);
    let trimmed_persona = system_prompt.trim();
    if !guidance.is_empty() || !trimmed_persona.is_empty() {
        prompt.push_str(&format!("[算子准则]\n{}{}\n\n", guidance, trimmed_persona));
    }
    prompt.push_str(&format!("[操作员输入]\n{user_input}"));
    prompt
}

/// Direct-API fallback for the single engine. The stateless HTTP channel
/// cannot hold persona context, so the soul + system prompt travel as a
/// real `system` role message on every turn; the kernel route above is
/// the reference behaviour (seed once per task).
async fn execute_single_direct(
    app: &AppHandle,
    http: &Client,
    profiles: &[AiProfile],
    base_messages: &[ChatMessage],
    project: Option<(&str, &str, Option<&str>)>,
    soul: Option<&str>,
) -> Vec<ChatMessage> {
    let Some(profile) = profiles.first() else {
        return vec![];
    };
    let mut seeded = profile.clone();
    let mut system = String::new();
    if let Some(s) = soul.map(str::trim).filter(|s| !s.is_empty()) {
        system.push_str(&format!("[人格设定]\n{s}\n\n"));
    }
    if !seeded.system_prompt.trim().is_empty() {
        system.push_str(seeded.system_prompt.trim());
    }
    seeded.system_prompt = system;

    let api_messages = to_api_messages(base_messages, Some(&seeded));
    let start_time = std::time::Instant::now();
    let message_id = Uuid::new_v4().to_string();
    match send_chat(http, &seeded, &api_messages).await {
        Ok(response) => {
            let latency = start_time.elapsed().as_millis() as u64;
            let prompt_toks = crate::tokens::estimate_tokens(&seeded.system_prompt)
                + api_messages
                    .iter()
                    .map(|m| crate::tokens::estimate_tokens(&m.content))
                    .sum::<usize>();
            let comp_toks = crate::tokens::estimate_tokens(&response.content);
            crate::tokens::record_usage(
                app,
                &profile.model,
                prompt_toks,
                comp_toks,
                latency,
                project.map(|(id, name, _)| (id, name)),
            );
            vec![ChatMessage {
                id: message_id,
                role: "assistant".to_string(),
                content: response.content,
                speaker_id: Some(profile.id.clone()),
                speaker_name: profile.name.clone(),
                avatar: profile.avatar.clone(),
                pending: false,
                error: false,
                prompt_tokens: Some(prompt_toks),
                completion_tokens: Some(comp_toks),
                latency_ms: Some(latency),
                tool_calls: None,
            }]
        }
        Err(err) => vec![ChatMessage {
            id: message_id,
            role: "assistant".to_string(),
            content: err.to_string(),
            speaker_id: Some(profile.id.clone()),
            speaker_name: profile.name.clone(),
            avatar: profile.avatar.clone(),
            pending: false,
            error: true,
            prompt_tokens: None,
            completion_tokens: None,
            latency_ms: Some(start_time.elapsed().as_millis() as u64),
            tool_calls: None,
        }],
    }
}

/// Default single-conversation kernel turn: one profile, one kernel
/// session, persona seeded once per task (plus once per route change).
async fn execute_single_kernel(
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
    // Seed rule: no settled assistant reply yet (new task, or a retry
    // before any answer landed), OR the route changed since the last
    // seed (the bridge reset the kernel session), OR the process
    // restarted (cache miss while history already exists — the seeded
    // turn predates this process, so re-seed rather than lose persona).
    let settled = has_settled_assistant(base_messages);
    let rerouted = single_route_cache()
        .lock()
        .await
        .get(conversation)
        .map(|seeded| seeded != &fingerprint)
        .unwrap_or(settled);
    let seed = !settled || rerouted;
    let prompt = single_kernel_prompt(&user_input, soul, &profile.system_prompt, &profile.endpoint, seed);
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
        base_url: normalize_base_url(&profile.endpoint),
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
            // Cache the seeded route only after a successful turn: a
            // failed seed must retry with the persona instead of being
            // mistaken for an established session.
            if seed {
                let mut cache = single_route_cache().lock().await;
                if cache.len() >= SINGLE_ROUTE_CACHE_CAP {
                    cache.clear();
                }
                cache.insert(conversation.to_string(), fingerprint);
            }
            let prompt_tokens = turn
                .input_tokens
                .map(|n| n as usize)
                .unwrap_or_else(|| crate::tokens::estimate_tokens(&prompt));
            let completion_tokens = turn
                .output_tokens
                .map(|n| n as usize)
                .unwrap_or_else(|| crate::tokens::estimate_tokens(&turn.final_response));
            let reply = ChatMessage {
                id: stage_id.clone(),
                role: "assistant".to_string(),
                content: turn.final_response.clone(),
                speaker_id: Some(profile.id.clone()),
                speaker_name: profile.name.clone(),
                avatar: profile.avatar.clone(),
                pending: false,
                error: false,
                prompt_tokens: Some(prompt_tokens),
                completion_tokens: Some(completion_tokens),
                latency_ms: Some(latency),
                tool_calls: turn.tool_calls,
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
                id: stage_id.clone(),
                role: "assistant".to_string(),
                content: err.clone(),
                speaker_id: Some(profile.id.clone()),
                speaker_name: profile.name.clone(),
                avatar: profile.avatar.clone(),
                pending: false,
                error: true,
                prompt_tokens: None,
                completion_tokens: None,
                latency_ms: Some(start_time.elapsed().as_millis() as u64),
                tool_calls: None,
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
        let guidance = web_access_guidance(&profile.endpoint);
        let persona_block = if persona.is_empty() && guidance.is_empty() {
            String::new()
        } else {
            format!("[算子准则]\n{}{}\n\n", guidance, persona)
        };
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
            let result = post_turn(app, http, daemon_url, &request, std::time::Duration::from_secs(600)).await;
            (profile, prompt, start_time, result)
        }
    });

    let results = futures::future::join_all(futures).await;

    results
        .into_iter()
        .map(|(profile, prompt, start_time, result)| {
            let latency = start_time.elapsed().as_millis() as u64;
            match result {
                Ok(turn) => {
                    record_turn_usage(app, profile.model.trim(), &prompt, &turn, latency, project);
                    let prompt_tokens = turn
                        .input_tokens
                        .map(|n| n as usize)
                        .unwrap_or_else(|| crate::tokens::estimate_tokens(&prompt));
                    let completion_tokens = turn
                        .output_tokens
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
                        prompt_tokens: Some(prompt_tokens),
                        completion_tokens: Some(completion_tokens),
                        latency_ms: Some(latency),
                        tool_calls: turn.tool_calls,
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
                    prompt_tokens: None,
                    completion_tokens: None,
                    latency_ms: Some(latency),
                    tool_calls: None,
                },
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
                    prompt_tokens: Some(prompt_tokens),
                    completion_tokens: Some(completion_tokens),
                    latency_ms: Some(latency),
                    tool_calls: None,
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
                    prompt_tokens: None,
                    completion_tokens: None,
                    latency_ms: Some(latency),
                    tool_calls: None,
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
                Ok(response) => {
                    let prompt_tokens = crate::tokens::estimate_tokens(&profile.system_prompt)
                        + base_messages.iter().map(|m| crate::tokens::estimate_tokens(&m.content)).sum::<usize>();
                    let completion_tokens = crate::tokens::estimate_tokens(&response.content);
                    ChatMessage {
                        id: message_id,
                        role: "assistant".to_string(),
                        content: response.content,
                        speaker_id: Some(profile.id.clone()),
                        speaker_name: profile.name.clone(),
                        avatar: profile.avatar.clone(),
                        pending: false,
                        error: false,
                        prompt_tokens: Some(prompt_tokens),
                        completion_tokens: Some(completion_tokens),
                        latency_ms: None,
                        tool_calls: None,
                    }
                }
                Err(err) => ChatMessage {
                    id: message_id,
                    role: "assistant".to_string(),
                    content: err.to_string(),
                    speaker_id: Some(profile.id.clone()),
                    speaker_name: profile.name.clone(),
                    avatar: profile.avatar.clone(),
                    pending: false,
                    error: true,
                    prompt_tokens: None,
                    completion_tokens: None,
                    latency_ms: None,
                    tool_calls: None,
                },
            }
        })
        .collect()
}
