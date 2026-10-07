use tauri::AppHandle;
use crate::storage;

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
