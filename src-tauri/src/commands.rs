use tauri::{AppHandle, State};

use crate::models::{
    AiProfile, AppSettings, ChatMessage, ChatRequest, ChatResponse, OrchestrationRequest, Project,
};
use crate::orchestration;
use crate::storage;

// ─── Settings ──────────────────────────────────────────────────

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    storage::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    storage::save_settings(&app, &settings)
}

// ─── Chat History ──────────────────────────────────────────────

#[tauri::command]
pub fn load_history(app: AppHandle) -> Result<Vec<ChatMessage>, String> {
    storage::load_history(&app)
}

#[tauri::command]
pub fn save_history(app: AppHandle, messages: Vec<ChatMessage>) -> Result<(), String> {
    storage::save_history(&app, &messages)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<(), String> {
    storage::clear_history(&app)
}

// ─── Profile management ────────────────────────────────────────

#[tauri::command]
pub fn create_profile() -> AiProfile {
    storage::create_profile()
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, profile_id: String) -> Result<AppSettings, String> {
    storage::delete_profile(&app, &profile_id)
}

// ─── Single chat call (kept for direct use) ────────────────────

#[tauri::command]
pub async fn send_chat(
    state: State<'_, crate::AppState>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    crate::ai_client::send_chat(&state.http, &request.profile, &request.messages)
        .await
        .map_err(|err| err.to_string())
}

// ─── Orchestration ─────────────────────────────────────────────

#[tauri::command]
pub async fn execute_orchestration(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    request: OrchestrationRequest,
) -> Result<Vec<ChatMessage>, String> {
    // Resolve the owning project for token accounting and kernel workspace.
    let project = request
        .conversation_id
        .as_ref()
        .and_then(|cid| storage::find_session(&app, cid))
        .and_then(|session| session.project_id)
        .and_then(|project_id| {
            storage::load_projects(&app)
                .ok()
                .and_then(|projects| projects.into_iter().find(|p| p.id == project_id))
        });

    // Active persona content (Souls/<folder>/SOUL.md) injected into prompts.
    let soul = storage::load_active_soul_content(&app);

    let replies = orchestration::execute(
        &app,
        &state.http,
        &state.kernel_http,
        &state.daemon,
        &request.profiles,
        &request.messages,
        &request.mode,
        request.conversation_id.clone(),
        request.reasoning_effort,
        request.execution_mode,
        project.as_ref().map(|p| (p.id.as_str(), p.name.as_str(), p.default_directory.as_deref())),
        soul.as_deref(),
    )
    .await?;

    // Server-side persistence: settle the turn into the session file so the
    // frontend needs no extra save_session_messages/list_sessions round-trip
    // after every reply. Messages = base + merged replies.
    if let Some(session_id) = &request.conversation_id {
        let mut persisted = request.messages.clone();
        for reply in &replies {
            // A reply whose id matches a prior message replaces it (retry);
            // otherwise it appends.
            if let Some(slot) = persisted.iter_mut().find(|m| m.id == reply.id) {
                *slot = reply.clone();
            } else {
                persisted.push(reply.clone());
            }
        }
        if let Err(err) = storage::save_session_messages(&app, session_id, &persisted) {
            // Persistence failure must not fail the turn the user already
            // saw; the frontend's debounced autosave remains the safety net.
            eprintln!("[orchestration] session persist failed: {err}");
        }
    }

    Ok(replies)
}

#[tauri::command]
pub fn build_orchestration(profiles: Vec<AiProfile>) -> Vec<crate::models::OrchestrationStage> {
    orchestration::build_stages(&profiles)
}

// ─── DSH Core Daemon Controls ──────────────────────────────────

#[tauri::command]
pub async fn start_harness_daemon(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<crate::daemon::HarnessConnection, String> {
    let mut daemon = state.daemon.lock().await;
    daemon.start(&state.http, &app).await
}

#[tauri::command]
pub async fn stop_harness_daemon(
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut daemon = state.daemon.lock().await;
    daemon.stop().await
}

#[tauri::command]
pub async fn get_harness_connection(
    state: State<'_, crate::AppState>,
) -> Result<crate::daemon::HarnessConnection, String> {
    let daemon = state.daemon.lock().await;
    Ok(daemon.connection.clone())
}

// ─── Native System Bridges ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTelemetry {
    pub os: String,
    pub arch: String,
    pub core_count: usize,
    pub hostname: String,
    pub app_version: String,
}

#[tauri::command]
pub fn get_system_telemetry() -> SystemTelemetry {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "ATRIUM-TERMINAL".to_string());

    SystemTelemetry {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        core_count: cores,
        hostname: host,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn open_path_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开目录: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
    Ok(())
}

#[tauri::command]
pub fn get_default_workspace_path(app: AppHandle) -> Result<String, String> {
    storage::config_dir(&app).map(|p| p.to_string_lossy().to_string())
}

// ─── Native Window Frame Controls ──────────────────────────────

#[tauri::command]
pub fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// ─── Embedded PTY Terminals ────────────────────────────────────

#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    id: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<crate::terminal::TerminalInfo, String> {
    state.terminals.create(&app, id, cwd, cols, rows)
}

#[tauri::command]
pub fn write_terminal(state: State<'_, crate::AppState>, id: String, data: String) -> Result<(), String> {
    state.terminals.write(&id, data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, crate::AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.terminals.resize(&id, cols, rows)
}

#[tauri::command]
pub fn close_terminal(state: State<'_, crate::AppState>, id: String) -> Result<(), String> {
    state.terminals.close(&id)
}

// ─── Provider probe ────────────────────────────────────────────

/// The prompt the probe sends. One word: the reply only has to exist, and a
/// long probe prompt would make the probe cost real money.
const PROBE_PROMPT: &str = "ping";

/// What the probe learned, rendered for the user.
struct ProbeOutcome {
    status: String,
    /// Whether the reply actually carried text, which separates "the route
    /// works" from "the route answered with nothing usable".
    produced_text: bool,
}

/// Whether a protocol's reply envelope carried any non-empty text.
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

/// What to tell the user for a failed status, chosen per code: the remedy
/// differs completely between a bad key and a gateway that never implemented
/// the selected protocol.
fn probe_status_hint(status: reqwest::StatusCode) -> &'static str {
    match status.as_u16() {
        401 | 403 => "请检查 API Key",
        404 => "请检查 API 地址与所选协议是否匹配（该端点可能未实现此协议路径）",
        429 => "请求过于频繁或额度不足",
        400 | 422 => "请检查模型名称与协议参数是否被该端点接受",
        _ => "请检查凭据或地址",
    }
}

/// Send one minimal real inference request and report what came back.
///
/// A listing probe (`GET /models`) cannot answer the question the user actually
/// has before a session starts. It passes when the endpoint is reachable, the
/// key is honoured *by the listing route*, and that path exists — while the real
/// request still fails on an unknown model name, a gateway that never
/// implemented the selected protocol, a rejected request field, or a key that
/// carries inference but not list permission. The user then sees a green
/// "connected" and a broken first message.
///
/// So the probe speaks the selected protocol: the same endpoint resolution, the
/// same auth headers and the same request shape the product uses, trimmed to
/// the smallest reply that protocol allows.
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

    // Deliberately minimal. `max_tokens` is sent only where the protocol
    // requires it (Anthropic) and nowhere else, because that field has been
    // renamed and is rejected outright by newer OpenAI models — a probe that
    // tripped over its own payload would report a working provider as broken.
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
        // A real generation is slower than a listing, and a cold model can take
        // a while to produce its first token.
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("无法连通 {url}: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        // The provider usually explains itself, and that explanation is the
        // only thing that distinguishes "wrong key" from "wrong model name" or
        // "this field is not supported here".
        let detail = crate::ai_client::readable_error_body(&body);
        let hint = probe_status_hint(status);
        return Err(if detail.trim().is_empty() {
            format!("{url} 返回 {status}，{hint}")
        } else {
            format!("{url} 返回 {status}（{hint}）：{detail}")
        });
    }

    // A 2xx is not automatically a working route: some gateways answer 200 with
    // an empty envelope. Read the text where this protocol carries it.
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
        // Reachable and authenticated, but the reply carried nothing. That is
        // still a broken route for a chat product, so it is not a pass.
        Err(format!(
            "{model} 返回 {} 但没有产出任何文本，该模型或协议可能不受支持",
            outcome.status
        ))
    }
}

// ─── Token Statistics ──────────────────────────────────────────

#[tauri::command]
pub fn get_token_statistics(app: AppHandle) -> crate::tokens::TokenMetrics {
    crate::tokens::load_metrics(&app)
}

#[tauri::command]
pub fn reset_token_statistics(app: AppHandle) -> Result<crate::tokens::TokenMetrics, String> {
    crate::tokens::reset_metrics(&app)
}

// ─── Multi-Session Storage ─────────────────────────────────────

#[tauri::command]
pub fn list_sessions(app: AppHandle) -> Result<Vec<storage::SessionSummary>, String> {
    storage::list_sessions(&app)
}

#[tauri::command]
pub fn create_session(
    app: AppHandle,
    title: Option<String>,
    project_id: Option<String>,
) -> Result<storage::SessionSummary, String> {
    let t = title.unwrap_or_default();
    storage::create_session_in_project(&app, &t, project_id.as_deref())
}

/// Next default task title parts ("任务N：M.D"); the webview localizes the
/// final string. Returns {number, date} instead of a finished string so the
/// kernel side stays i18n-free.
#[tauri::command]
pub fn generate_session_title(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<storage::SessionSummaryTitle, String> {
    storage::generate_session_title(&app, project_id.as_deref())
}

// ─── Projects ──────────────────────────────────────────────────

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    storage::ensure_projects(&app)
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    name: String,
    description: Option<String>,
    directories: Vec<String>,
    default_directory: Option<String>,
) -> Result<Project, String> {
    storage::create_project(
        &app,
        &name,
        description.as_deref().unwrap_or(""),
        directories,
        default_directory,
    )
}

#[tauri::command]
pub fn update_project(app: AppHandle, project: Project) -> Result<Project, String> {
    let normalized = storage::normalize_project(project);
    storage::update_project(&app, normalized)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, project_id: String) -> Result<(), String> {
    storage::delete_project(&app, &project_id)
}

/// One-round-trip project deletion: returns the refreshed project/session
/// lists plus the fallback project id for the UI to activate.
#[tauri::command]
pub fn delete_project_aggregated(
    app: AppHandle,
    project_id: String,
) -> Result<storage::ProjectDeletionResult, String> {
    storage::delete_project_aggregated(&app, &project_id)
}

#[tauri::command]
pub fn get_project_token_stats(
    app: AppHandle,
    project_id: String,
) -> crate::tokens::ProjectUsageStats {
    crate::tokens::load_metrics(&app)
        .projects
        .into_iter()
        .find(|p| p.project_id == project_id)
        .unwrap_or_default()
}

// ─── Souls (personas) ──────────────────────────────────────────

#[tauri::command]
pub fn list_souls(app: AppHandle) -> Result<Vec<storage::Soul>, String> {
    storage::list_souls(&app)
}

#[tauri::command]
pub fn create_soul(
    app: AppHandle,
    name: String,
    description: Option<String>,
) -> Result<storage::Soul, String> {
    storage::create_soul(&app, &name, description.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn save_soul(
    app: AppHandle,
    folder: String,
    name: String,
    description: String,
    content: String,
) -> Result<storage::Soul, String> {
    storage::save_soul(&app, &folder, &name, &description, &content)
}

#[tauri::command]
pub fn delete_soul(app: AppHandle, folder: String) -> Result<(), String> {
    storage::delete_soul(&app, &folder)
}

#[tauri::command]
pub fn load_session_messages(app: AppHandle, session_id: String) -> Result<Vec<ChatMessage>, String> {
    storage::load_session_messages(&app, &session_id)
}

#[tauri::command]
pub fn save_session_messages(
    app: AppHandle,
    session_id: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    storage::save_session_messages(&app, &session_id, &messages)
}

#[tauri::command]
pub fn rename_session(
    app: AppHandle,
    session_id: String,
    new_title: String,
) -> Result<storage::SessionSummary, String> {
    storage::rename_session(&app, &session_id, &new_title)
}

#[tauri::command]
pub fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
    storage::delete_session(&app, &session_id)
}

// ─── Git Source Control ────────────────────────────────────────

#[tauri::command]
pub fn git_init(repo_path: String) -> Result<crate::git::GitRepoInfo, String> {
    crate::git::init_repo(&repo_path)
}

#[tauri::command]
pub fn git_detect_repos(project_path: String) -> Result<Vec<crate::git::GitRepoInfo>, String> {
    crate::git::detect_repos(&project_path)
}

/// Detect repos + read each working-tree status in one call (1+N → 1 invoke).
#[tauri::command]
pub fn git_detect_repos_with_status(
    project_path: String,
) -> Result<Vec<crate::git::GitRepoSnapshot>, String> {
    crate::git::detect_repos_with_status(&project_path)
}

#[tauri::command]
pub fn git_get_status(repo_path: String) -> Result<crate::git::GitRepoStatus, String> {
    crate::git::get_repo_status(&repo_path)
}

#[tauri::command]
pub fn git_stage_file(repo_path: String, file_path: String) -> Result<(), String> {
    crate::git::stage_file(&repo_path, &file_path)
}

#[tauri::command]
pub fn git_unstage_file(repo_path: String, file_path: String) -> Result<(), String> {
    crate::git::unstage_file(&repo_path, &file_path)
}

#[tauri::command]
pub fn git_stage_all(repo_path: String) -> Result<(), String> {
    crate::git::stage_all(&repo_path)
}

#[tauri::command]
pub fn git_unstage_all(repo_path: String) -> Result<(), String> {
    crate::git::unstage_all(&repo_path)
}

#[tauri::command]
pub fn git_discard_file(repo_path: String, file_path: String) -> Result<(), String> {
    crate::git::discard_file(&repo_path, &file_path)
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    crate::git::commit(&repo_path, &message)
}

#[tauri::command]
pub fn git_push(repo_path: String) -> Result<String, String> {
    crate::git::push(&repo_path)
}

#[tauri::command]
pub fn git_pull(repo_path: String) -> Result<String, String> {
    crate::git::pull(&repo_path)
}

#[tauri::command]
pub fn git_fetch(repo_path: String) -> Result<String, String> {
    crate::git::fetch(&repo_path)
}

#[tauri::command]
pub fn git_get_log(repo_path: String, max_count: Option<usize>) -> Result<Vec<crate::git::GitCommit>, String> {
    crate::git::get_log(&repo_path, max_count)
}

#[tauri::command]
pub fn git_get_diff(repo_path: String, file_path: String, staged: bool) -> Result<String, String> {
    crate::git::get_diff(&repo_path, &file_path, staged)
}
#[cfg(test)]
mod tests {
    use super::{probe_reply_has_text, probe_status_hint};
    use crate::ai_client::inference_endpoint;
    use reqwest::StatusCode;
    use serde_json::json;

    /// The probe must resolve the same URL the product posts to, whether the
    /// settings form stored a complete endpoint or a hand-typed base URL.
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

    /// A 200 that carries no text is not a working route, so the probe has to
    /// look where each protocol actually puts its reply text. These pin all
    /// three envelopes plus the empty shapes that must not pass.
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
        // A thinking block is not an answer.
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

    /// Each status implies a different fix, so the hint must not collapse into
    /// one generic message — that is what made the old probe useless.
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



