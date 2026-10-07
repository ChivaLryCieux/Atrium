pub mod common;
pub mod stages;
pub mod transport;
pub mod single;
pub mod dag;
pub mod parallel;

use reqwest::Client;
use tauri::AppHandle;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::daemon::DshDaemon;
use crate::models::{AiProfile, ChatMessage};

pub use stages::build_stages;
pub use common::{cancel_conversation, register_cancellation, unregister_cancellation};

use common::kernel_unavailable_message;
use dag::execute_dag_kernel;
use parallel::execute_parallel_kernel;
use single::{execute_single_kernel, reset_single_route_cache};

pub async fn execute(
    app: &AppHandle,
    http: &Client,
    kernel_http: &Client,
    daemon: &Mutex<DshDaemon>,
    profiles: &[AiProfile],
    base_messages: &[ChatMessage],
    mode: &str,
    conversation_id: Option<String>,
    reasoning_effort: Option<String>,
    execution_mode: Option<String>,
    project: Option<(&str, &str, Option<&str>)>,
    soul: Option<&str>,
) -> Result<Vec<ChatMessage>, String> {
    let execution_mode = execution_mode
        .as_deref()
        .filter(|m| matches!(*m, "plan" | "ask" | "auto"))
        .map(str::to_string);

    let kernel_compatible = profiles
        .first()
        .map(|p| {
            matches!(
                p.api_protocol.trim(),
                "" | "openai-chat" | "anthropic-messages" | "openai-responses"
            )
        })
        .unwrap_or(false);

    let (kernel_ready, kernel_detail) = if !kernel_compatible {
        (false, None)
    } else {
        let mut guard = daemon.lock().await;
        let _ = guard.ensure_running(http, app).await;
        if guard.take_reseed_required() {
            reset_single_route_cache();
        }
        if !guard.kernel_available() {
            let _ = guard.start(http, app).await;
        }
        (guard.kernel_available(), guard.kernel_detail().map(str::to_string))
    };

    if !kernel_ready {
        return Err(kernel_unavailable_message(profiles, kernel_detail.as_deref()));
    }

    let conversation = conversation_id.unwrap_or_else(|| format!("adhoc-{}", Uuid::new_v4()));
    if mode == "parallel" {
        Ok(execute_parallel_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await)
    } else if mode == "single" {
        Ok(execute_single_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await)
    } else {
        Ok(execute_dag_kernel(app, kernel_http, profiles, base_messages, &conversation, reasoning_effort, execution_mode, project, soul).await)
    }
}
