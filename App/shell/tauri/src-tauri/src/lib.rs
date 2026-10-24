//! Memmy Turbo Tauri 2 shell. All sensitive native operations are explicitly
//! routed through typed, auditable Rust commands; no generic shell invoke.
use std::fs;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

fn is_loopback_runtime_config(value: &serde_json::Value) -> bool {
    let Some(base) = value.get("baseUrl").and_then(serde_json::Value::as_str) else {
        return false;
    };
    let Some(token) = value.get("localToken").and_then(serde_json::Value::as_str) else {
        return false;
    };
    if token.trim().is_empty() { return false; }
    let Ok(url) = url::Url::parse(base) else {
        return false;
    };
    url.scheme() == "http"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == "/"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
}

#[tauri::command]
fn desktop_runtime_config(app: AppHandle) -> Result<serde_json::Value, String> {
    // The new native runtime must create this file after launching its loopback
    // backend with a random session token. Do not load Electron data directories
    // or silently create a fake token; native backend migration is a release gate.
    let directory = app.path().app_local_data_dir().map_err(|_| "app data directory unavailable")?;
    let path = directory.join("runtime-config.json");
    let raw = fs::read_to_string(&path).map_err(|_| {
        "Tauri runtime not provisioned: native backend startup is still pending".to_string()
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| "invalid native runtime config")?;
    if !is_loopback_runtime_config(&value) {
        return Err("native runtime config rejected: loopback/token contract invalid".into());
    }
    Ok(value)
}

#[tauri::command]
fn desktop_app_info(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Memmy",
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "isPackaged": !cfg!(debug_assertions),
        "isWindowsStore": false
    })
}

#[tauri::command]
fn desktop_check_for_updates(app: AppHandle) -> serde_json::Value {
    // An updater without signed Tauri release metadata must never claim a
    // package update exists. This path remains a tracked parity blocker.
    serde_json::json!({
        "status": "not-configured",
        "currentVersion": app.package_info().version.to_string()
    })
}

#[tauri::command]
fn desktop_open_external(app: AppHandle, address: String) -> Result<(), String> {
    let parsed = url::Url::parse(&address).map_err(|_| "invalid external URL")?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("external URL scheme is not allowed".into());
    }
    app.opener().open_url(address, None::<&str>).map_err(|_| "failed to open external URL".into())
}

#[tauri::command]
fn desktop_fullscreen(window: WebviewWindow) -> Result<serde_json::Value, String> {
    let is_full_screen = window.is_fullscreen().map_err(|_| "window state unavailable")?;
    Ok(serde_json::json!({ "isFullScreen": is_full_screen }))
}

#[tauri::command]
fn desktop_complete_window_action(
    window: WebviewWindow,
    resolution: String
) -> Result<(), String> {
    match resolution.as_str() {
        "minimize" | "hide" => window.minimize().map_err(|_| "minimize failed".into()),
        "close" | "quit" => window.close().map_err(|_| "close failed".into()),
        _ => Err("window action not yet supported by Tauri parity layer".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_config,
            desktop_app_info,
            desktop_check_for_updates,
            desktop_open_external,
            desktop_fullscreen,
            desktop_complete_window_action
        ])
        .run(tauri::generate_context!())
        .expect("Memmy Turbo Tauri shell failed");
}

#[cfg(test)]
mod tests {
    use super::is_loopback_runtime_config;
    use serde_json::json;

    #[test]
    fn runtime_config_requires_local_origin_and_auth_token() {
        assert!(is_loopback_runtime_config(&json!({
            "baseUrl": "http://127.0.0.1:3100", "localToken": "random-session-token"
        })));
        for base in ["https://example.com/", "http://10.0.0.3:3100/", "file:///tmp/",
            "http://127.0.0.1:3000/token", "http://localhost:3000/?token=secret"] {
            assert!(!is_loopback_runtime_config(&json!({
                "baseUrl": base, "localToken": "token"
            })));
        }
        assert!(!is_loopback_runtime_config(&json!({
            "baseUrl": "http://127.0.0.1:3100", "localToken": ""
        })));
    }
}
