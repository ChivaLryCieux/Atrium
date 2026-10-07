use tauri::{AppHandle, State};
use crate::models::{AiProfile, ChatMessage, OrchestrationRequest};
use crate::orchestration;
use crate::storage;

#[tauri::command]
pub async fn execute_orchestration(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    request: OrchestrationRequest,
) -> Result<Vec<ChatMessage>, String> {
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
pub fn build_orchestration(profiles: Vec<AiProfile>) -> Vec<crate::models::OrchestrationStage> {
    orchestration::build_stages(&profiles)
}
