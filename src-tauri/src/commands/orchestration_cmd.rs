use tauri::{AppHandle, State, Emitter};
use crate::models::{AiProfile, ChatMessage, OrchestrationProgress, OrchestrationRequest};
use crate::orchestration;
use crate::storage;

#[tauri::command]
pub async fn execute_orchestration(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    request: OrchestrationRequest,
) -> Result<Vec<ChatMessage>, String> {
    if let Some(cid) = &request.conversation_id {
        orchestration::register_cancellation(cid).await;
    }

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

    let soul = storage::load_active_soul_content(&app);

    let res = orchestration::execute(
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
    .await;

    if let Some(cid) = &request.conversation_id {
        orchestration::unregister_cancellation(cid).await;
    }

    let replies = res?;

    if let Some(session_id) = &request.conversation_id {
        let mut persisted = request.messages.clone();
        for reply in &replies {
            if let Some(slot) = persisted.iter_mut().find(|m| m.id == reply.id) {
                *slot = reply.clone();
            } else {
                persisted.push(reply.clone());
            }
        }
        if let Err(err) = storage::save_session_messages(&app, session_id, &persisted) {
            eprintln!("[orchestration] session persist failed: {err}");
        }
    }

    Ok(replies)
}

#[tauri::command]
pub async fn abort_orchestration(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    conversation_id: String,
) -> Result<bool, String> {
    // 1. Mark cancellation flag in Rust
    orchestration::cancel_conversation(&conversation_id).await;

    // 2. Notify kernel bridge / daemon over HTTP
    let (daemon_url, token) = {
        let daemon = state.daemon.lock().await;
        (daemon.connection.url.clone(), daemon.connection.token.clone())
    };
    let abort_url = format!("{daemon_url}/v1/abort");
    let payload = serde_json::json!({
        "conversationId": conversation_id,
    });

    let mut req_builder = state.http.post(&abort_url).json(&payload);
    if let Some(token) = token {
        req_builder = req_builder.bearer_auth(token);
    }

    let _ = req_builder.send().await;

    // 3. Emit progress event to UI
    let _ = app.emit(
        "orchestration-progress",
        OrchestrationProgress {
            stage_id: format!("{conversation_id}-abort"),
            stage_title: "暂停".to_string(),
            profile_name: String::new(),
            status: "paused".to_string(),
            content: Some("操作员已暂停任务".to_string()),
            message_id: None,
        },
    );

    Ok(true)
}

#[tauri::command]
pub fn build_orchestration(profiles: Vec<AiProfile>) -> Vec<crate::models::OrchestrationStage> {
    orchestration::build_stages(&profiles)
}
