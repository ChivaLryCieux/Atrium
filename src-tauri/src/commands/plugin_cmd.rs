//! Plugin management proxied through the Tauri command layer.
//!
//! The frontend previously fetched the kernel bridge HTTP API directly,
//! bypassing the IPC contract and exposing the bridge token to the webview's
//! fetch surface. These commands are the single audited funnel: they attach
//! the session token server-side and forward verbatim JSON both ways.

use tauri::State;

use crate::daemon::HarnessConnection;

async fn bridge_base(state: &State<'_, crate::AppState>) -> Result<(String, Option<String>), String> {
    let daemon = state.daemon.lock().await;
    let conn: &HarnessConnection = &daemon.connection;
    if conn.status != "ready" && conn.status != "connected" {
        return Err("内核桥接未就绪，请稍后重试".to_string());
    }
    Ok((conn.url.clone(), conn.token.clone()))
}

async fn post_json(
    state: &State<'_, crate::AppState>,
    path: &str,
    body: serde_json::Value,
    long_timeout: bool,
) -> Result<serde_json::Value, String> {
    let (base, token) = bridge_base(state).await?;
    let client = if long_timeout { &state.kernel_http } else { &state.http };
    let mut req = client
        .post(format!("{base}{path}"))
        .json(&body);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let resp = req.send().await.map_err(|e| format!("内核桥接请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("内核桥接响应读取失败: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": text }));
    if !status.is_success() {
        let detail = json
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("内核桥接返回错误");
        return Err(format!("内核桥接返回 {status}: {detail}"));
    }
    Ok(json)
}

async fn get_json(
    state: &State<'_, crate::AppState>,
    path: &str,
) -> Result<serde_json::Value, String> {
    let (base, token) = bridge_base(state).await?;
    let mut req = state.http.get(format!("{base}{path}"));
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let resp = req.send().await.map_err(|e| format!("内核桥接请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("内核桥接响应读取失败: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": text }));
    if !status.is_success() {
        let detail = json
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("内核桥接返回错误");
        return Err(format!("内核桥接返回 {status}: {detail}"));
    }
    Ok(json)
}

#[tauri::command]
pub async fn list_plugins(
    state: State<'_, crate::AppState>,
    profile: Option<String>,
) -> Result<serde_json::Value, String> {
    let profile = profile.unwrap_or_else(|| "sdk".to_string());
    get_json(&state, &format!("/api/plugins?profile={profile}")).await
}

#[tauri::command]
pub async fn toggle_plugin_bundle(
    state: State<'_, crate::AppState>,
    name: String,
    enabled: bool,
    profile: Option<String>,
) -> Result<serde_json::Value, String> {
    post_json(
        &state,
        "/api/plugins/bundle/toggle",
        serde_json::json!({
            "profile": profile.unwrap_or_else(|| "sdk".to_string()),
            "name": name,
            "enabled": enabled,
        }),
        false,
    )
    .await
}

#[tauri::command]
pub async fn toggle_patch_plugin(
    state: State<'_, crate::AppState>,
    id: Option<String>,
    name: Option<String>,
    enabled: bool,
    profile: Option<String>,
) -> Result<serde_json::Value, String> {
    post_json(
        &state,
        "/api/plugins/plugin/toggle",
        serde_json::json!({
            "profile": profile.unwrap_or_else(|| "sdk".to_string()),
            "id": id,
            "name": name,
            "enabled": enabled,
        }),
        false,
    )
    .await
}

#[tauri::command]
pub async fn install_plugin(
    state: State<'_, crate::AppState>,
    spec: String,
    registry: Option<String>,
    profile: Option<String>,
) -> Result<serde_json::Value, String> {
    // pnpm installs legitimately run for minutes — use the long-timeout client.
    post_json(
        &state,
        "/api/plugins/install",
        serde_json::json!({
            "profile": profile.unwrap_or_else(|| "sdk".to_string()),
            "spec": spec,
            "registry": registry,
        }),
        true,
    )
    .await
}

#[tauri::command]
pub async fn remove_plugin(
    state: State<'_, crate::AppState>,
    name: String,
    profile: Option<String>,
) -> Result<serde_json::Value, String> {
    post_json(
        &state,
        "/api/plugins/remove",
        serde_json::json!({
            "profile": profile.unwrap_or_else(|| "sdk".to_string()),
            "name": name,
        }),
        true,
    )
    .await
}

#[tauri::command]
pub async fn inspect_plugin(
    state: State<'_, crate::AppState>,
    spec: String,
    registry: Option<String>,
) -> Result<serde_json::Value, String> {
    post_json(
        &state,
        "/api/plugins/inspect",
        serde_json::json!({ "spec": spec, "registry": registry }),
        false,
    )
    .await
}
