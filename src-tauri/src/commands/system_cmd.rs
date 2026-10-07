use tauri::AppHandle;
use crate::storage;

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

#[tauri::command]
pub fn read_workspace_tree(
    root: String,
    max_depth: Option<usize>,
) -> Result<Vec<crate::models::WorkspaceEntry>, String> {
    let root_path = std::path::Path::new(&root);
    if !root_path.exists() {
        return Err(format!("工作区目录不存在: {root}"));
    }
    if !root_path.is_dir() {
        return Err(format!("指定路径不是目录: {root}"));
    }

    let depth = max_depth.unwrap_or(3);
    fn scan_dir(dir: &std::path::Path, current_depth: usize, max_d: usize) -> Vec<crate::models::WorkspaceEntry> {
        if current_depth > max_d {
            return Vec::new();
        }
        let mut entries = Vec::new();
        let read = match std::fs::read_dir(dir) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        for item in read.flatten() {
            let path = item.path();
            let file_name = match item.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };

            if file_name.starts_with('.') && file_name != ".gitignore" && file_name != ".env" {
                continue;
            }
            if file_name == "node_modules"
                || file_name == "target"
                || file_name == "dist"
                || file_name == ".git"
                || file_name == ".kernel-dist"
            {
                continue;
            }

            let meta = item.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let children = if is_dir && current_depth < max_d {
                Some(scan_dir(&path, current_depth + 1, max_d))
            } else if is_dir {
                Some(Vec::new())
            } else {
                None
            };

            entries.push(crate::models::WorkspaceEntry {
                name: file_name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                size,
                modified,
                children,
            });
        }

        entries.sort_by(|a, b| {
            if a.is_dir != b.is_dir {
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        entries
    }

    Ok(scan_dir(root_path, 1, depth))
}

#[tauri::command]
pub fn read_file_preview(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    if p.is_dir() {
        return Err(format!("指定路径是目录: {path}"));
    }

    let limit = max_bytes.unwrap_or(100 * 1024);
    let file = std::fs::File::open(p).map_err(|e| format!("无法读取文件: {e}"))?;
    use std::io::Read;
    let mut handle = file.take(limit as u64);
    let mut buf = Vec::new();
    handle.read_to_end(&mut buf).map_err(|e| format!("读取失败: {e}"))?;

    let content = String::from_utf8_lossy(&buf).to_string();
    Ok(content)
}

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

#[tauri::command]
pub fn get_token_statistics(app: AppHandle) -> crate::tokens::TokenMetrics {
    crate::tokens::load_metrics(&app)
}

#[tauri::command]
pub fn reset_token_statistics(app: AppHandle) -> Result<crate::tokens::TokenMetrics, String> {
    crate::tokens::reset_metrics(&app)
}
