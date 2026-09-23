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
        request.conversation_id,
        request.reasoning_effort,
        request.execution_mode,
        project.as_ref().map(|p| (p.id.as_str(), p.name.as_str(), p.default_directory.as_deref())),
        soul.as_deref(),
    )
    .await;
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

#[tauri::command]
pub async fn probe_provider(
    state: State<'_, crate::AppState>,
    endpoint: String,
    api_key: String,
    api_protocol: String,
) -> Result<String, String> {
    let base = endpoint.trim().trim_end_matches('/');
    let base = base
        .strip_suffix("/chat/completions")
        .or_else(|| base.strip_suffix("/responses"))
        .or_else(|| base.strip_suffix("/v1/messages"))
        .unwrap_or(base);
    if base.is_empty() {
        return Err("API 地址为空".to_string());
    }

    // Anthropic authenticates with x-api-key + a version header; everything
    // else uses bearer tokens.
    let mut request = state
        .http
        .get(format!("{base}/models"))
        .timeout(std::time::Duration::from_secs(10));
    request = if api_protocol.trim() == "anthropic-messages" {
        request
            .header("x-api-key", api_key.trim())
            .header("anthropic-version", "2023-06-01")
    } else {
        request.bearer_auth(api_key.trim())
    };

    let response = request
        .send()
        .await
        .map_err(|e| format!("无法连通 {base}: {e}"))?;

    let status = response.status();
    if status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let count = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("data").and_then(|d| d.as_array()).map(|a| a.len()))
            .map(|n| format!("，可用模型 {n} 个"))
            .unwrap_or_default();
        Ok(format!("连通正常 ({status}){count}"))
    } else {
        Err(format!("{base} 返回 {status}，请检查凭据或地址"))
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

