use tauri::AppHandle;
use crate::models::Project;
use crate::storage;

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
