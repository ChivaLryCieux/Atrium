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
