use std::{fs, path::PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::models::{AiProfile, AppSettings, ProviderModel};
use super::fs_utils::{atomic_write, config_dir};

const SETTINGS_FILE: &str = "settings.json";

/// Kernel-aligned seed catalog for profiles that carry no model list yet.
pub fn seed_models(default: Option<&str>) -> Vec<ProviderModel> {
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

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(SETTINGS_FILE))
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        user_name: "我".to_string(),
        ai_profiles: vec![default_profile()],
        orchestration_mode: "single".to_string(),
        reasoning_effort: None,
        theme_mode: Some("light".to_string()),
        font_size: Some("14px".to_string()),
        active_soul: Some(super::souls::DEFAULT_SOUL_FOLDER.to_string()),
        active_profile_id: None,
        selected_model: None,
    }
}

pub fn default_profile() -> AiProfile {
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
pub fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    if settings.ai_profiles.is_empty() {
        settings.ai_profiles = vec![default_profile()];
    }
    if settings.orchestration_mode == "dag"
        || (settings.orchestration_mode != "single"
            && settings.orchestration_mode != "parallel")
    {
        settings.orchestration_mode = "single".to_string();
    }
    for profile in &mut settings.ai_profiles {
        if profile.models.is_empty() {
            profile.models = seed_models(Some(&profile.model));
        }
        if profile.model.trim().is_empty() {
            profile.model = profile.models.first().map(|m| m.name.clone()).unwrap_or_default();
        }
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
    let profile_ok = settings
        .active_profile_id
        .as_deref()
        .map(|id| settings.ai_profiles.iter().any(|p| p.id == id))
        .unwrap_or(false);
    if !profile_ok {
        settings.active_profile_id = None;
        settings.selected_model = None;
    } else if let Some(model) = &settings.selected_model {
        let listed = settings
            .ai_profiles
            .iter()
            .find(|p| Some(&p.id) == settings.active_profile_id.as_ref())
            .map(|p| p.models.iter().any(|m| &m.name == model) || p.model == *model)
            .unwrap_or(false);
        if !listed {
            settings.selected_model = None;
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
    if settings.active_profile_id.as_deref() == Some(profile_id) {
        settings.active_profile_id = None;
        settings.selected_model = None;
    }
    let normalized = normalize_settings(settings);
    save_settings(app, &normalized)?;
    Ok(normalized)
}
