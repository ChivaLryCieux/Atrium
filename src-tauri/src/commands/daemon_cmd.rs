use tauri::{AppHandle, State};

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
