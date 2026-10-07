use std::{fs, path::PathBuf};
use tauri::AppHandle;

use crate::models::ChatMessage;
use super::fs_utils::{atomic_write, config_dir};
use super::sessions::sessions_dir;

const HISTORY_FILE: &str = "chat_history.json";

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(HISTORY_FILE))
}

pub fn load_history(app: &AppHandle) -> Result<Vec<ChatMessage>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|err| format!("无法读取聊天记录: {err}"))?;
    let mut msgs: Vec<ChatMessage> = serde_json::from_str(&text).map_err(|err| format!("聊天记录格式无效: {err}"))?;
    if super::sessions::deduplicate_message_ids(&mut msgs) {
        let _ = save_history(app, &msgs);
    }
    Ok(msgs)
}

pub fn save_history(app: &AppHandle, messages: &[ChatMessage]) -> Result<(), String> {
    let path = history_path(app)?;
    let text = serde_json::to_string_pretty(messages)
        .map_err(|err| format!("无法序列化聊天记录: {err}"))?;
    atomic_write(&path, &text)
}

pub fn clear_history(app: &AppHandle) -> Result<(), String> {
    let path = history_path(app)?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    let s_dir = sessions_dir(app)?;
    if s_dir.exists() {
        let _ = fs::remove_dir_all(&s_dir);
    }
    Ok(())
}
