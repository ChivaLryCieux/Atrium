use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::{AiProfile, AppSettings, ChatMessage, Project, ProviderModel};

const SETTINGS_FILE: &str = "settings.json";
const HISTORY_FILE: &str = "chat_history.json";
const PROJECTS_FILE: &str = "projects.json";
const SOULS_DIR: &str = "Souls";
pub const DEFAULT_SOUL_FOLDER: &str = "Default";

/// Kernel-aligned seed catalog for profiles that carry no model list yet.
fn seed_models(default: Option<&str>) -> Vec<ProviderModel> {
    let catalog = [
        ("deepseek-flash", Some(1_000_000u64)),
        ("deepseek-v4-pro", Some(1_000_000)),
    ];
    let mut models: Vec<ProviderModel> = catalog
        .iter()
        .map(|(name, ctx)| ProviderModel {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            context_length: *ctx,
        })
        .collect();
    if let Some(name) = default.map(str::trim).filter(|s| !s.is_empty()) {
        if !models.iter().any(|m| m.name == name) {
            models.insert(
                0,
                ProviderModel { id: Uuid::new_v4().to_string(), name: name.to_string(), context_length: None },
            );
        }
    }
    models
}

// ─── Paths ─────────────────────────────────────────────────────

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("无法定位应用配置目录: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用配置目录: {err}"))?;
    Ok(dir)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(SETTINGS_FILE))
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(HISTORY_FILE))
}

/// Crash-safe write: serialize to a uniquely-named temp file first, then
/// rename over the target. The unique name keeps concurrent writers (e.g.
/// settings saved on every keystroke) from corrupting each other's temp file.
fn atomic_write(path: &PathBuf, contents: &str) -> Result<(), String> {
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

// ─── Settings ──────────────────────────────────────────────────

fn default_settings() -> AppSettings {
    AppSettings {
        user_name: "我".to_string(),
        ai_profiles: vec![default_profile()],
        orchestration_mode: "dag".to_string(),
        reasoning_effort: None,
        theme_mode: Some("light".to_string()),
        font_size: Some("14px".to_string()),
        active_soul: Some(DEFAULT_SOUL_FOLDER.to_string()),
    }
}

fn default_profile() -> AiProfile {
    AiProfile {
        id: "atrium-prime".to_string(),
        name: "Atrium Prime".to_string(),
        description: String::new(),
        avatar: "ATRIUM".to_string(),
        endpoint: "https://api.deepseek.com/v1/chat/completions".to_string(),
        api_key: String::new(),
        api_protocol: "openai-chat".to_string(),
        model: "deepseek-flash".to_string(),
        models: seed_models(Some("deepseek-flash")),
        system_prompt: "你是 Atrium 智役中庭的主控智能体（Atrium Prime）。作为装具中枢，你冷静、精确、恪守事实，提供高信息密度、逻辑严谨的工程与技术分析。".to_string(),
        temperature: 0.5,
    }
}

/// Ensure settings have valid defaults.
fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    if settings.ai_profiles.is_empty() {
        settings.ai_profiles = vec![default_profile()];
    }
    if settings.orchestration_mode != "dag" && settings.orchestration_mode != "parallel" {
        settings.orchestration_mode = "dag".to_string();
    }
    for profile in &mut settings.ai_profiles {
        // Legacy settings carry a single `model` string and no list.
        if profile.models.is_empty() {
            profile.models = seed_models(Some(&profile.model));
        }
        if profile.model.trim().is_empty() {
            profile.model = profile.models.first().map(|m| m.name.clone()).unwrap_or_default();
        }
        // Keep the inference endpoint in complete form (base + protocol
        // suffix). The endpoint's existing suffix is the ground truth of
        // what actually gets called, so it wins over the stored protocol;
        // a bare base gets the protocol's suffix appended.
        let endpoint = profile.endpoint.trim().trim_end_matches('/').to_string();
        if !endpoint.is_empty() {
            let known = if endpoint.ends_with("/v1/messages") {
                Some("anthropic-messages")
            } else if endpoint.ends_with("/responses") {
                Some("openai-responses")
            } else if endpoint.ends_with("/chat/completions") {
                Some("openai-chat")
            } else {
                None
            };
            match known {
                Some(protocol) => {
                    if profile.api_protocol.trim() != protocol {
                        profile.api_protocol = protocol.to_string();
                    }
                }
                None => {
                    let suffix = match profile.api_protocol.trim() {
                        "anthropic-messages" => "/v1/messages",
                        "openai-responses" => "/responses",
                        _ => "/chat/completions",
                    };
                    profile.endpoint = format!("{endpoint}{suffix}");
                }
            }
        }
    }
    if let Some(effort) = &settings.reasoning_effort {
        if !["off", "low", "high", "max"].contains(&effort.as_str()) {
            settings.reasoning_effort = None;
        }
    }
    if let Some(theme) = &settings.theme_mode {
        if ![
            "pure-white",
            "pure-black",
            "atrium-color",
            "system",
            // Legacy values; the frontend migrates them to the named themes.
            "light",
            "dark",
        ]
        .contains(&theme.as_str())
        {
            settings.theme_mode = None;
        }
    }
    if let Some(size) = &settings.font_size {
        if !["13px", "14px", "15px"].contains(&size.as_str()) {
            settings.font_size = None;
        }
    }
    settings
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(default_settings());
    }
    let text = fs::read_to_string(&path).map_err(|err| format!("无法读取设置: {err}"))?;
    let settings: AppSettings =
        serde_json::from_str(&text).map_err(|err| format!("设置文件格式无效: {err}"))?;
    Ok(normalize_settings(settings))
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text =
        serde_json::to_string_pretty(settings).map_err(|err| format!("无法序列化设置: {err}"))?;
    atomic_write(&path, &text)
}

// ─── Chat History ──────────────────────────────────────────────

pub fn load_history(app: &AppHandle) -> Result<Vec<ChatMessage>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|err| format!("无法读取聊天记录: {err}"))?;
    serde_json::from_str(&text).map_err(|err| format!("聊天记录格式无效: {err}"))
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

// ─── Multi-Session Structured Storage ──────────────────────────

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

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("sessions");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 sessions 目录: {e}"))?;
    Ok(dir)
}

fn sessions_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sessions_dir(app)?.join("index.json"))
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

/// Look up one session summary by id (used to resolve the owning project).
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
    serde_json::from_str(&text).map_err(|e| format!("消息格式无效: {e}"))
}

pub fn save_session_messages(app: &AppHandle, session_id: &str, messages: &[ChatMessage]) -> Result<(), String> {
    let path = sessions_dir(app)?.join(format!("{session_id}.json"));
    let text = serde_json::to_string_pretty(messages).map_err(|e| format!("序列化消息失败: {e}"))?;
    atomic_write(&path, &text)?;

    // Update count in index
    let mut sessions = list_sessions(app).unwrap_or_default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if let Some(s) = sessions.iter_mut().find(|s| s.id == session_id) {
        s.message_count = messages.len();
        s.updated_at = now;
        if s.title == "新任务" {
            if let Some(first_user) = messages.iter().find(|m| m.role == "user") {
                let first_line = first_user.content.lines().next().unwrap_or(&first_user.content);
                s.title = first_line.chars().take(20).collect();
            }
        }
        let _ = save_session_index(app, &sessions);
    }

    Ok(())
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

// ─── Create profile ────────────────────────────────────────────

pub fn create_profile() -> AiProfile {
    AiProfile {
        id: Uuid::new_v4().to_string(),
        name: String::new(),
        description: String::new(),
        avatar: "NODE".to_string(),
        endpoint: "https://api.deepseek.com/v1/chat/completions".to_string(),
        api_key: String::new(),
        api_protocol: "openai-chat".to_string(),
        model: "deepseek-flash".to_string(),
        models: seed_models(Some("deepseek-flash")),
        system_prompt: "你是搭载于 Atrium 智役中庭的高效工程智能体，专注于结构化分析与解决问题。".to_string(),
        temperature: 0.5,
    }
}

pub fn delete_profile(app: &AppHandle, profile_id: &str) -> Result<AppSettings, String> {
    let mut settings = load_settings(app)?;
    settings.ai_profiles.retain(|p| p.id != profile_id);
    if settings.ai_profiles.is_empty() {
        settings.ai_profiles = vec![default_profile()];
    }
    save_settings(app, &settings)?;
    Ok(settings)
}

// ─── Projects ──────────────────────────────────────────────────

fn projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(PROJECTS_FILE))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let path = projects_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("无法读取项目列表: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("项目列表格式无效: {e}"))
}

fn save_projects(app: &AppHandle, projects: &[Project]) -> Result<(), String> {
    let path = projects_path(app)?;
    let text = serde_json::to_string_pretty(projects).map_err(|e| format!("序列化项目失败: {e}"))?;
    atomic_write(&path, &text)
}

/// Guarantee at least one project exists and every session belongs to one.
/// Legacy sessions (no project) are migrated into the default project.
pub fn ensure_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let mut projects = load_projects(app)?;
    if projects.is_empty() {
        let fallback_dir = config_dir(app)?.to_string_lossy().to_string();
        let default_project = Project {
            id: Uuid::new_v4().to_string(),
            name: "默认项目".to_string(),
            description: "自动创建的默认工作项目".to_string(),
            directories: vec![fallback_dir.clone()],
            default_directory: Some(fallback_dir),
            created_at: now_secs(),
        };
        projects.push(default_project);
        save_projects(app, &projects)?;
    }

    let default_id = projects[0].id.clone();
    let mut sessions = list_sessions(app).unwrap_or_default();
    let migrated = sessions
        .iter_mut()
        .filter(|s| s.project_id.is_none())
        .map(|s| {
            s.project_id = Some(default_id.clone());
        })
        .count();
    if migrated > 0 {
        save_session_index(app, &sessions)?;
    }

    Ok(projects)
}

pub fn create_project(
    app: &AppHandle,
    name: &str,
    description: &str,
    directories: Vec<String>,
    default_directory: Option<String>,
) -> Result<Project, String> {
    let mut projects = load_projects(app)?;
    let fallback_dir = config_dir(app)?.to_string_lossy().to_string();

    let mut directories = directories
        .into_iter()
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .collect::<Vec<_>>();
    if directories.is_empty() {
        directories.push(fallback_dir);
    }

    let default_directory = default_directory
        .filter(|d| directories.iter().any(|x| x == d))
        .or_else(|| directories.first().cloned());

    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: if name.trim().is_empty() { format!("项目{}", projects.len() + 1) } else { name.trim().to_string() },
        description: description.trim().to_string(),
        directories,
        default_directory,
        created_at: now_secs(),
    };
    projects.push(project.clone());
    save_projects(app, &projects)?;
    Ok(project)
}

pub fn update_project(app: &AppHandle, project: Project) -> Result<Project, String> {
    let mut projects = load_projects(app)?;
    let Some(entry) = projects.iter_mut().find(|p| p.id == project.id) else {
        return Err(format!("项目不存在: {}", project.id));
    };
    *entry = project.clone();
    save_projects(app, &projects)?;
    Ok(project)
}

/// Trim and validate a project coming from the frontend before persisting.
pub fn normalize_project(mut project: Project) -> Project {
    project.name = project.name.trim().to_string();
    project.description = project.description.trim().to_string();

    let mut seen = std::collections::HashSet::new();
    project.directories = project
        .directories
        .iter()
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty() && seen.insert(d.clone()))
        .collect();

    project.default_directory = project
        .default_directory
        .take()
        .filter(|d| project.directories.iter().any(|x| x == d))
        .or_else(|| project.directories.first().cloned());
    project
}

// ─── Souls (personas) ──────────────────────────────────────────

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

fn souls_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

/// Guarantee the Souls root and the Default persona exist.
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
    // Folder names come from directory entries; reject traversal shapes.
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

    // Default first, then alphabetical.
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

/// Content of the active persona, resolved for prompt injection.
pub fn load_active_soul_content(app: &AppHandle) -> Option<String> {
    let folder = load_settings(app)
        .ok()
        .and_then(|s| s.active_soul)
        .unwrap_or_else(|| DEFAULT_SOUL_FOLDER.to_string());
    read_soul(app, &folder)
        .map(|soul| soul.content)
        .filter(|content| !content.trim().is_empty())
}
