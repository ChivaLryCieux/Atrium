use tauri::AppHandle;
use crate::models::ChatMessage;
use crate::storage;

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

#[tauri::command]
pub fn generate_session_title(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<storage::SessionSummaryTitle, String> {
    storage::generate_session_title(&app, project_id.as_deref())
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
pub fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
    storage::delete_session(&app, &session_id)
}
