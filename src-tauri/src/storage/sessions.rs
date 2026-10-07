use std::{fs, path::PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::models::ChatMessage;
use super::fs_utils::{atomic_write, config_dir};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub message_count: usize,
    /// Owning project; legacy sessions are migrated to the default project.
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryTitle {
    pub number: u32,
    /// "M.D" (e.g. "9.23").
    pub date: String,
}

pub fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("sessions");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 sessions 目录: {e}"))?;
    Ok(dir)
}

fn sessions_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sessions_dir(app)?.join("index.json"))
}

pub fn deduplicate_message_ids(msgs: &mut [ChatMessage]) -> bool {
    let mut seen_ids = std::collections::HashSet::new();
    let mut modified = false;
    for (i, msg) in msgs.iter_mut().enumerate() {
        if msg.id.is_empty() || seen_ids.contains(&msg.id) {
            msg.id = format!("{}-{i}", if msg.id.is_empty() { "msg" } else { &msg.id });
            if seen_ids.contains(&msg.id) {
                msg.id = Uuid::new_v4().to_string();
            }
            modified = true;
        }
        seen_ids.insert(msg.id.clone());
    }
    modified
}

pub fn list_sessions(app: &AppHandle) -> Result<Vec<SessionSummary>, String> {
    let path = sessions_index_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("无法读取会话索引: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("会话索引格式无效: {e}"))
}

pub fn save_session_index(app: &AppHandle, sessions: &[SessionSummary]) -> Result<(), String> {
    let path = sessions_index_path(app)?;
    let text = serde_json::to_string_pretty(sessions).map_err(|e| format!("序列化会话失败: {e}"))?;
    atomic_write(&path, &text)
}

pub fn create_session_in_project(
    app: &AppHandle,
    title: &str,
    project_id: Option<&str>,
) -> Result<SessionSummary, String> {
    let mut sessions = list_sessions(app).unwrap_or_default();
    let id = Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let summary = SessionSummary {
        id: id.clone(),
        title: if title.trim().is_empty() { "新任务".to_string() } else { title.trim().to_string() },
        updated_at: now,
        message_count: 0,
        project_id: project_id.map(str::to_string),
    };

    sessions.insert(0, summary.clone());
    save_session_index(app, &sessions)?;
    save_session_messages(app, &id, &[])?;

    Ok(summary)
}

pub fn generate_session_title(
    app: &AppHandle,
    project_id: Option<&str>,
) -> Result<SessionSummaryTitle, String> {
    let sessions = list_sessions(app)?;
    let relevant: Vec<&SessionSummary> = sessions
        .iter()
        .filter(|s| project_id.is_none() || s.project_id.as_deref() == project_id)
        .collect();

    let mut max_num: u32 = 0;
    for s in &relevant {
        let title = &s.title;
        let mut idx = 0usize;
        let mut prefix_task = false;
        while idx < title.len() {
            let rest = &title[idx..];
            if rest.starts_with("任务") {
                idx += "任务".len();
                prefix_task = true;
                break;
            }
            if rest.len() >= 4 && rest[..4].eq_ignore_ascii_case("task") {
                idx += 4;
                prefix_task = true;
                break;
            }
            idx += 1;
        }
        if !prefix_task {
            continue;
        }
        let rest = &title[idx..];
        let rest = rest.trim_start();
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>() {
            if n > max_num {
                max_num = n;
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = now / 86_400;
    let (_year, month, day) = civil_from_days(days as i64);

    let next_num = std::cmp::max(relevant.len() as u32 + 1, max_num + 1);
    Ok(SessionSummaryTitle {
        number: next_num,
        date: format!("{month}.{day}"),
    })
}

/// Days-since-epoch → (year, month, day). Howard Hinnant's algorithm.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn find_session(app: &AppHandle, session_id: &str) -> Option<SessionSummary> {
    list_sessions(app)
        .ok()?
        .into_iter()
        .find(|s| s.id == session_id)
}

pub fn load_session_messages(app: &AppHandle, session_id: &str) -> Result<Vec<ChatMessage>, String> {
    let path = sessions_dir(app)?.join(format!("{session_id}.json"));
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取会话消息失败: {e}"))?;
    let mut msgs: Vec<ChatMessage> = serde_json::from_str(&text).map_err(|e| format!("消息格式无效: {e}"))?;
    if deduplicate_message_ids(&mut msgs) {
        let _ = save_session_messages(app, session_id, &msgs);
    }
    Ok(msgs)
}

pub fn save_session_messages(app: &AppHandle, session_id: &str, messages: &[ChatMessage]) -> Result<(), String> {
    let path = sessions_dir(app)?.join(format!("{session_id}.json"));
    let text = serde_json::to_string_pretty(messages).map_err(|e| format!("序列化消息失败: {e}"))?;
    atomic_write(&path, &text)?;

    let mut sessions = list_sessions(app).unwrap_or_default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if let Some(s) = sessions.iter_mut().find(|s| s.id == session_id) {
        s.message_count = messages.len();
        s.updated_at = now;
        let _ = save_session_index(app, &sessions);
    }

    Ok(())
}

pub fn rename_session(app: &AppHandle, session_id: &str, new_title: &str) -> Result<SessionSummary, String> {
    let mut sessions = list_sessions(app)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if let Some(s) = sessions.iter_mut().find(|s| s.id == session_id) {
        let trimmed = new_title.trim();
        if !trimmed.is_empty() {
            s.title = trimmed.to_string();
        }
        s.updated_at = now;
        let updated = s.clone();
        save_session_index(app, &sessions)?;
        Ok(updated)
    } else {
        Err(format!("Session {session_id} not found"))
    }
}

pub fn delete_session(app: &AppHandle, session_id: &str) -> Result<(), String> {
    let mut sessions = list_sessions(app).unwrap_or_default();
    sessions.retain(|s| s.id != session_id);
    save_session_index(app, &sessions)?;

    let path = sessions_dir(app)?.join(format!("{session_id}.json"));
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_civil_from_days_epoch() {
        // Day 0 is 1970-01-01
        let (y, m, d) = civil_from_days(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn test_civil_from_days_known_date() {
        // 2026-10-07: 20734 days since epoch
        // Let's compute days for 2000-01-01: 10957 days
        let (y, m, d) = civil_from_days(10957);
        assert_eq!((y, m, d), (2000, 1, 1));
    }

    #[test]
    fn test_deduplicate_message_ids() {
        let mut msgs = vec![
            ChatMessage {
                id: "same-id".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
                speaker_id: None,
                speaker_name: "User".to_string(),
                avatar: String::new(),
                pending: false,
                error: false,
                prompt_tokens: None,
                completion_tokens: None,
                latency_ms: None,
                tool_calls: None,
                reasoning_content: None,
                reasoning_duration_ms: None,
            },
            ChatMessage {
                id: "same-id".to_string(),
                role: "assistant".to_string(),
                content: "world".to_string(),
                speaker_id: None,
                speaker_name: "Assistant".to_string(),
                avatar: String::new(),
                pending: false,
                error: false,
                prompt_tokens: None,
                completion_tokens: None,
                latency_ms: None,
                tool_calls: None,
                reasoning_content: None,
                reasoning_duration_ms: None,
            },
        ];
        let modified = deduplicate_message_ids(&mut msgs);
        assert!(modified);
        assert_ne!(msgs[0].id, msgs[1].id);
    }
}
