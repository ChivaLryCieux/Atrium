use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("无法定位应用配置目录: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用配置目录: {err}"))?;
    Ok(dir)
}

/// Crash-safe write: serialize to a uniquely-named temp file first, then
/// rename over the target. The unique name keeps concurrent writers (e.g.
/// settings saved on every keystroke) from corrupting each other's temp file.
pub fn atomic_write(path: &PathBuf, contents: &str) -> Result<(), String> {
    let tmp_path = path.with_extension(format!("json.tmp-{}", Uuid::new_v4().simple()));
    fs::write(&tmp_path, contents).map_err(|err| format!("无法写入临时文件 {}: {err}", tmp_path.display()))?;
    match fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(rename_err) if path.exists() => {
            fs::remove_file(path).map_err(|err| format!("无法替换旧文件: {err}"))?;
            fs::rename(&tmp_path, path)
                .map_err(|err| format!("无法完成保存: {err}; 初次替换失败: {rename_err}"))
        }
        Err(err) => {
            let _ = fs::remove_file(&tmp_path);
            Err(format!("无法完成保存: {err}"))
        }
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
