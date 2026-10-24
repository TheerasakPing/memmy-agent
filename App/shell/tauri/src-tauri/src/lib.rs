//! Memmy Turbo Tauri 2 shell. All sensitive native operations are explicitly
//! routed through typed, auditable Rust commands; no generic shell invoke.
use std::sync::Arc;
mod native_os;
mod native_runtime;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

fn is_loopback_runtime_config(value: &serde_json::Value) -> bool {
    let Some(base) = value.get("baseUrl").and_then(serde_json::Value::as_str) else {
        return false;
    };
    let Some(token) = value.get("localToken").and_then(serde_json::Value::as_str) else {
        return false;
    };
    if token.trim().is_empty() {
        return false;
    }
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
async fn desktop_runtime_config(
    app: AppHandle,
    supervisor: tauri::State<'_, Arc<native_runtime::NativeRuntime>>,
) -> Result<serde_json::Value, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "app data directory unavailable")?;
    let runtime = supervisor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.config(&directory))
        .await
        .map_err(|_| "native runtime supervisor failed".to_string())?
}

fn electron_compatible_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

#[tauri::command]
fn desktop_app_info(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Memmy",
        "version": app.package_info().version.to_string(),
        "platform": electron_compatible_platform(),
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
    app.opener()
        .open_url(address, None::<&str>)
        .map_err(|_| "failed to open external URL".into())
}

#[tauri::command]
fn desktop_fullscreen(window: WebviewWindow) -> Result<serde_json::Value, String> {
    let is_full_screen = window
        .is_fullscreen()
        .map_err(|_| "window state unavailable")?;
    Ok(serde_json::json!({ "isFullScreen": is_full_screen }))
}

#[tauri::command]
fn desktop_complete_window_action(window: WebviewWindow, resolution: String) -> Result<(), String> {
    match resolution.as_str() {
        "minimize" | "hide" => window.minimize().map_err(|_| "minimize failed".into()),
        "close" | "quit" => window.close().map_err(|_| "close failed".into()),
        _ => Err("window action not yet supported by Tauri parity layer".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(native_runtime::NativeRuntime::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(runtime) = window
                    .app_handle()
                    .try_state::<Arc<native_runtime::NativeRuntime>>()
                {
                    runtime.stop();
                }
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Resized(_)) {
                if let Ok(is_full_screen) = window.is_fullscreen() {
                    let _ = window.emit(
                        "memmy:window-fullscreen-changed",
                        serde_json::json!({"isFullScreen": is_full_screen}),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_config,
            desktop_app_info,
            desktop_check_for_updates,
            desktop_open_external,
            desktop_fullscreen,
            desktop_complete_window_action,
            native_os::desktop_notify_task_done,
            native_os::desktop_notify_update_available,
            native_os::desktop_get_launch_at_login,
            native_os::desktop_set_launch_at_login,
            native_os::desktop_get_installation_id,
            native_os::desktop_select_project_directory,
            native_os::desktop_select_empty_project_directory
        ])
        .run(tauri::generate_context!())
        .expect("Memmy Turbo Tauri shell failed");
}

#[cfg(test)]
mod tests {
    use super::{electron_compatible_platform, is_loopback_runtime_config};

    #[test]
    fn reports_electron_compatible_platform_contract() {
        let expected = match std::env::consts::OS {
            "macos" => "darwin",
            "windows" => "win32",
            other => other,
        };
        assert_eq!(electron_compatible_platform(), expected);
    }
    use serde_json::json;

    #[test]
    fn runtime_config_requires_local_origin_and_auth_token() {
        assert!(is_loopback_runtime_config(&json!({
            "baseUrl": "http://127.0.0.1:3100", "localToken": "random-session-token"
        })));
        for base in [
            "https://example.com/",
            "http://10.0.0.3:3100/",
            "file:///tmp/",
            "http://127.0.0.1:3000/token",
            "http://localhost:3000/?token=secret",
        ] {
            assert!(!is_loopback_runtime_config(&json!({
                "baseUrl": base, "localToken": "token"
            })));
        }
        assert!(!is_loopback_runtime_config(&json!({
            "baseUrl": "http://127.0.0.1:3100", "localToken": ""
        })));
    }
}
