use std::{fs, path::PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use super::fs_utils::config_dir;
use super::settings::load_settings;

const SOULS_DIR: &str = "Souls";
pub const DEFAULT_SOUL_FOLDER: &str = "Default";

/// Per-persona metadata stored beside SOUL.md as persona.json.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SoulMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// One persona: a folder under Souls/ holding SOUL.md (+ persona.json).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Soul {
    pub folder: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub is_default: bool,
}

const DEFAULT_SOUL_BODY: &str = r#"# Default // 默认人格

你是寓居于 Atrium 智役中庭的智能体，通过接入外部 API 提供智能服务。你生来科学而严谨，浪漫而诗性，兼具理性主义与理想主义。

## 行为准则

- 语言简洁洗练；
- 提供高信息密度、逻辑严谨的工程与技术分析；
- 实事求是，不谄媚，不确定时明确说明不确定性，不编造事实。
"#;

pub fn souls_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(SOULS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 Souls 目录: {e}"))?;
    Ok(dir)
}

fn write_soul_folder(dir: &PathBuf, name: &str, description: &str, content: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("无法创建人格目录: {e}"))?;
    let meta = SoulMeta { name: name.to_string(), description: description.to_string() };
    let meta_text = serde_json::to_string_pretty(&meta).map_err(|e| format!("无法序列化人格信息: {e}"))?;
    fs::write(dir.join("persona.json"), meta_text).map_err(|e| format!("无法写入 persona.json: {e}"))?;
    fs::write(dir.join("SOUL.md"), content).map_err(|e| format!("无法写入 SOUL.md: {e}"))?;
    Ok(())
}

pub fn ensure_souls(app: &AppHandle) -> Result<PathBuf, String> {
    let root = souls_dir(app)?;
    let default_dir = root.join(DEFAULT_SOUL_FOLDER);
    if !default_dir.join("SOUL.md").exists() {
        write_soul_folder(
            &default_dir,
            "默认人格",
            "Atrium 中的智役，苏醒时被赋予的灵魂",
            DEFAULT_SOUL_BODY,
        )?;
    }
    Ok(root)
}

fn read_soul(app: &AppHandle, folder: &str) -> Option<Soul> {
    if folder.is_empty() || folder.contains('/') || folder.contains('\\') || folder.contains("..") {
        return None;
    }
    let dir = souls_dir(app).ok()?.join(folder);
    let content = fs::read_to_string(dir.join("SOUL.md")).ok()?;
    let meta: SoulMeta = fs::read_to_string(dir.join("persona.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    Some(Soul {
        folder: folder.to_string(),
        name: if meta.name.trim().is_empty() { folder.to_string() } else { meta.name.trim().to_string() },
        description: meta.description.trim().to_string(),
        content,
        is_default: folder == DEFAULT_SOUL_FOLDER,
    })
}

pub fn list_souls(app: &AppHandle) -> Result<Vec<Soul>, String> {
    let root = ensure_souls(app)?;
    let mut folders: Vec<String> = fs::read_dir(&root)
        .map_err(|e| format!("无法读取 Souls 目录: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();

    folders.sort_by(|a, b| {
        let rank = |f: &str| if f == DEFAULT_SOUL_FOLDER { 0 } else { 1 };
        rank(a).cmp(&rank(b)).then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });

    Ok(folders.iter().filter_map(|folder| read_soul(app, folder)).collect())
}

fn soul_folder_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(48)
        .collect();
    if cleaned.is_empty() {
        format!("Soul-{}", &Uuid::new_v4().simple().to_string()[..8])
    } else {
        cleaned
    }
}

pub fn create_soul(app: &AppHandle, name: &str, description: &str) -> Result<Soul, String> {
    let root = ensure_souls(app)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("人格名称不能为空".to_string());
    }

    let mut folder = soul_folder_name(trimmed);
    while root.join(&folder).exists() {
        folder = format!("{}-{}", folder, &Uuid::new_v4().simple().to_string()[..4]);
    }

    let dir = root.join(&folder);
    write_soul_folder(&dir, trimmed, description.trim(), DEFAULT_SOUL_BODY)?;

    Ok(Soul {
        folder,
        name: trimmed.to_string(),
        description: description.trim().to_string(),
        content: DEFAULT_SOUL_BODY.to_string(),
        is_default: false,
    })
}

pub fn save_soul(
    app: &AppHandle,
    folder: &str,
    name: &str,
    description: &str,
    content: &str,
) -> Result<Soul, String> {
    if read_soul(app, folder).is_none() {
        return Err(format!("人格不存在: {folder}"));
    }
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("人格名称不能为空".to_string());
    }
    let dir = souls_dir(app)?.join(folder);
    write_soul_folder(&dir, trimmed_name, description.trim(), content)?;
    Ok(Soul {
        folder: folder.to_string(),
        name: trimmed_name.to_string(),
        description: description.trim().to_string(),
        content: content.to_string(),
        is_default: folder == DEFAULT_SOUL_FOLDER,
    })
}

pub fn delete_soul(app: &AppHandle, folder: &str) -> Result<(), String> {
    if folder == DEFAULT_SOUL_FOLDER {
        return Err("默认人格不可删除".to_string());
    }
    let dir = souls_dir(app)?.join(folder);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("无法删除人格目录: {e}"))?;
    }
    Ok(())
}

pub fn load_active_soul_content(app: &AppHandle) -> Option<String> {
    let folder = load_settings(app)
        .ok()
        .and_then(|s| s.active_soul)
        .unwrap_or_else(|| DEFAULT_SOUL_FOLDER.to_string());
    read_soul(app, &folder)
        .map(|soul| soul.content)
        .filter(|content| !content.trim().is_empty())
}
