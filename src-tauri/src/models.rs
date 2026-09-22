use serde::{Deserialize, Serialize};

// ─── Project ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub directories: Vec<String>,
    #[serde(default)]
    pub default_directory: Option<String>,
    #[serde(default)]
    pub created_at: u64,
}

// ─── AI Profile ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub context_length: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    /// Optional human-readable description; empty allowed.
    #[serde(default)]
    pub description: String,
    pub avatar: String,
    pub endpoint: String,
    pub api_key: String,
    /// Wire protocol of the provider's inference endpoint:
    /// openai-chat | openai-responses | anthropic-messages.
    #[serde(default = "default_api_protocol")]
    pub api_protocol: String,
    pub model: String,
    /// Models offered by this provider; `model` names the default entry.
    #[serde(default)]
    pub models: Vec<ProviderModel>,
    pub system_prompt: String,
    pub temperature: f32,
}

// ─── App Settings ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub user_name: String,
    pub ai_profiles: Vec<AiProfile>,
    #[serde(default = "default_orchestration_mode")]
    pub orchestration_mode: String,
    /// Kernel agent reasoning effort: off | low | high | max.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    /// UI theme mode: pure-white | pure-black | atrium-color | system.
    /// Legacy values (light/dark) are migrated by the frontend.
    #[serde(default)]
    pub theme_mode: Option<String>,
    /// UI font scale preset: 13px | 14px | 15px.
    #[serde(default)]
    pub font_size: Option<String>,
    /// Active persona folder under Souls/ (defaults to `Default`).
    #[serde(default)]
    pub active_soul: Option<String>,
}

fn default_orchestration_mode() -> String {
    "single".to_string()
}

fn default_api_protocol() -> String {
    "openai-chat".to_string()
}

// ─── Chat Messages ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub speaker_id: Option<String>,
    pub speaker_name: String,
    pub avatar: String,
    #[serde(default)]
    pub pending: bool,
    #[serde(default)]
    pub error: bool,
}

/// Wire format for OpenAI-compatible API (no camelCase needed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

// ─── Orchestration ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationStage {
    pub id: String,
    pub title: String,
    pub role: String,
    pub instruction: String,
    pub profile: AiProfile,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationRequest {
    pub profiles: Vec<AiProfile>,
    pub messages: Vec<ChatMessage>,
    pub mode: String,
    /// Atrium conversation identity; binds kernel sessions across turns.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// Kernel reasoning effort override for this run.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    /// Execution mode: plan | ask | auto (maps to DSH_PERMISSION_MODE).
    #[serde(default)]
    pub execution_mode: Option<String>,
}

/// Event emitted to the frontend during orchestration execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationProgress {
    pub stage_id: String,
    pub stage_title: String,
    pub profile_name: String,
    pub status: String, // "running" | "completed" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
}

// ─── Chat Request / Response (for single API call) ─────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub profile: AiProfile,
    pub messages: Vec<ApiMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
}

// ─── OpenAI response parsing helpers ───────────────────────────

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAiChoice {
    pub message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAiMessage {
    pub content: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAiErrorResponse {
    pub error: OpenAiError,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAiError {
    pub message: String,
}
