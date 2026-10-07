use tauri::{AppHandle, State};

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
