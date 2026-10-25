//! Memmy Turbo Tauri 2 shell. All sensitive native operations are explicitly
//! routed through typed, auditable Rust commands; no generic shell invoke.
use std::sync::{Arc, Mutex};
mod native_approvals;
mod native_browser;
mod native_browser_extension;
mod native_browser_inventory;
mod native_browser_store;
mod native_browser_surface;
mod native_diagnostics;
mod native_file_export;
mod native_os;
mod native_permissions;
mod native_pet;
mod native_runtime;
mod native_site_policy;
mod native_tray;
mod native_workspace;
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
    #[cfg(not(debug_assertions))]
    let bundled_root = Some(
        app.path()
            .resource_dir()
            .map_err(|_| "native resource directory unavailable")?
            .join("runtime"),
    );
    #[cfg(debug_assertions)]
    let bundled_root: Option<std::path::PathBuf> = None;
    let config = tauri::async_runtime::spawn_blocking(move || {
        runtime.config(&directory, bundled_root.as_deref())
    })
    .await
    .map_err(|_| "native runtime supervisor failed".to_string())??;
    if config["agentGateway"]["startupIssue"] == "model_config_invalid" {
        let _ = app.emit("memmy:agent-gateway-startup-issue", "model_config_invalid");
    }
    Ok(config)
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

#[derive(Default)]
struct PendingWindowAction(Mutex<Option<String>>);

fn validate_pending_action(state: &PendingWindowAction, response_id: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(response_id).is_err() {
        return Err("invalid window action request identifier".into());
    }
    let mut pending = state
        .0
        .lock()
        .map_err(|_| "window action lock unavailable")?;
    if pending.as_deref() != Some(response_id) {
        return Err("window action request was not pending".into());
    }
    *pending = None;
    Ok(())
}

#[tauri::command]
fn desktop_complete_window_action(
    window: WebviewWindow,
    pending: tauri::State<'_, PendingWindowAction>,
    response_id: String,
    resolution: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only main window can resolve main action".into());
    }
    // Do not permit renderer to force quit/hide without a user-originating OS event.
    validate_pending_action(&pending, &response_id)?;
    match resolution.as_str() {
        "minimize" => window.minimize().map_err(|_| "minimize failed".into()),
        "hide" => window.hide().map_err(|_| "hide failed".into()),
        "pet" => native_pet::desktop_set_pet_window(window.app_handle().clone(), true, None),
        "close" => window.destroy().map_err(|_| "close failed".into()),
        "quit" => {
            window.app_handle().exit(0);
            Ok(())
        }
        _ => Err("unsupported main window action".into()),
    }
}

#[tauri::command]
fn desktop_get_browser_sidebar_surface(
    window: WebviewWindow,
    supervisor: tauri::State<'_, Arc<native_runtime::NativeRuntime>>,
    session_key: String,
) -> Result<Option<serde_json::Value>, String> {
    if window.label() != "main" {
        return Err("only the main app can read Agent Browser surfaces".into());
    }
    Ok(supervisor.browser_surface(&session_key))
}

#[tauri::command]
async fn desktop_send_browser_sidebar_action(
    window: WebviewWindow,
    supervisor: tauri::State<'_, Arc<native_runtime::NativeRuntime>>,
    session_key: String,
    action: serde_json::Value,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("only the main app can send Agent Browser actions".into());
    }
    // Child stdin writes can block under backpressure: never stall the WebKit UI thread.
    let runtime = supervisor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.send_browser_surface_action(&session_key, &action)
    })
    .await
    .map_err(|_| "Agent Browser dispatcher unavailable".to_string())?
}

/// Validate an installed macOS preview without the GUI or production user data.
/// This intentionally requires a real bundle and launches all three services.
pub fn smoke_installed_runtime() -> i32 {
    let result = (|| -> Result<(), String> {
        let executable =
            std::env::current_exe().map_err(|_| "cannot resolve packaged executable")?;
        let resources = executable
            .parent()
            .and_then(std::path::Path::parent)
            .ok_or("expected macOS .app bundle layout")?
            .join("Resources/runtime");
        let data_dir =
            std::env::temp_dir().join(format!("memmy-standalone-smoke-{}", uuid::Uuid::new_v4()));
        let supervisor = native_runtime::NativeRuntime::default();
        let started = supervisor.config(&data_dir, Some(&resources));
        let outcome = started.and_then(|config| {
            if !config["baseUrl"]
                .as_str()
                .is_some_and(|v| v.starts_with("http://127.0.0.1:"))
                || !config["memory"]["baseUrl"]
                    .as_str()
                    .is_some_and(|v| v.starts_with("http://127.0.0.1:"))
                || !config["agentGateway"]["baseUrl"]
                    .as_str()
                    .is_some_and(|v| v.starts_with("http://127.0.0.1:"))
            {
                return Err("one or more native services did not become ready".into());
            }
            Ok(())
        });
        supervisor.stop();
        let _ = std::fs::remove_dir_all(&data_dir);
        outcome
    })();
    match result {
        Ok(()) => {
            eprintln!("PASS: packaged Memory + Local API + Agent Gateway start/stop");
            0
        }
        Err(error) => {
            eprintln!("FAIL: packaged runtime: {error}");
            1
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(native_runtime::NativeRuntime::default()))
        .manage(native_workspace::WorkspaceGrants::default())
        .manage(native_approvals::ApprovalLock::default())
        .manage(native_browser::NativeBrowsers::default())
        .manage(native_pet::PetDragState::default())
        .manage(native_permissions::ComputerHistorySession::default())
        .manage(native_tray::TrayState::default())
        .manage(PendingWindowAction::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app.state::<Arc<native_runtime::NativeRuntime>>()
                .attach_app(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Mirror the original Electron asynchronous close policy.
                    // Closing without React approval would bypass unsaved-work/pet guidance.
                    api.prevent_close();
                    if let Some(pending) = window.app_handle().try_state::<PendingWindowAction>() {
                        if let Ok(mut guard) = pending.0.lock() {
                            if guard.is_none() {
                                let id = uuid::Uuid::new_v4().to_string();
                                *guard = Some(id.clone());
                                let _ = window.emit(
                                    "memmy:main-window-action-request",
                                    serde_json::json!({"id":id,"action":"close"}),
                                );
                            }
                        }
                    }
                }
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(runtime) = window
                    .app_handle()
                    .try_state::<Arc<native_runtime::NativeRuntime>>()
                {
                    runtime.stop();
                }
            }
            if window.label() == "pet" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    let _ = main.show();
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
            native_os::desktop_select_empty_project_directory,
            native_workspace::desktop_read_workspace_directory,
            native_workspace::desktop_write_workspace_file,
            native_diagnostics::desktop_get_log_level,
            native_diagnostics::desktop_set_log_level,
            native_diagnostics::desktop_open_logs_directory,
            native_file_export::desktop_save_file,
            native_file_export::desktop_save_image,
            native_file_export::desktop_copy_image_to_clipboard,
            native_file_export::desktop_export_diagnostics_report,
            native_permissions::desktop_get_computer_history_permission_session_id,
            native_permissions::desktop_get_full_disk_access_status,
            native_permissions::desktop_guide_memmy_permission,
            native_permissions::desktop_restart_for_computer_history_permissions,
            native_permissions::desktop_open_computer_history_markdown,
            native_browser_extension::desktop_get_browser_extension_directory,
            native_browser_extension::desktop_reveal_browser_extension,
            native_browser_extension::desktop_prepare_browser_extension,
            native_browser_inventory::desktop_get_browser_extension_installation,
            native_browser_inventory::desktop_list_installed_browser_extensions,
            native_browser_inventory::desktop_list_running_external_browsers,
            native_browser::desktop_native_browser_create,
            native_browser::desktop_native_browser_bounds,
            native_browser::desktop_native_browser_action,
            native_browser::desktop_native_browser_destroy,
            desktop_get_browser_sidebar_surface,
            desktop_send_browser_sidebar_action,
            native_browser_store::desktop_get_browser_history,
            native_browser_store::desktop_import_legacy_browser_history,
            native_browser_store::desktop_remove_browser_history,
            native_browser_store::desktop_remove_selected_browser_history,
            native_browser_store::desktop_get_browser_access_rules,
            native_browser_store::desktop_set_browser_access_rule,
            native_site_policy::desktop_get_browser_use_site_policies,
            native_site_policy::desktop_upsert_browser_use_site_policy,
            native_site_policy::desktop_remove_browser_use_site_policy,
            native_approvals::desktop_get_native_app_allow_all,
            native_approvals::desktop_set_native_app_allow_all,
            native_approvals::desktop_get_browser_allow_all,
            native_approvals::desktop_set_browser_allow_all,
            native_browser_store::desktop_get_browser_download_settings,
            native_browser_store::desktop_choose_browser_download_directory,
            native_browser_store::desktop_reset_browser_download_directory,
            native_browser_store::desktop_set_browser_ask_before_download,
            native_pet::desktop_set_pet_window,
            native_pet::desktop_hide_pet_window,
            native_pet::desktop_sync_pet_window_layout,
            native_pet::desktop_start_pet_window_drag,
            native_pet::desktop_move_pet_window,
            native_pet::desktop_stop_pet_window_drag,
            native_tray::desktop_set_menu_bar_icon,
            native_tray::desktop_set_computer_history_tray_indicator
        ])
        .run(tauri::generate_context!())
        .expect("Memmy Turbo Tauri shell failed");
}

#[cfg(test)]
mod tests {
    use super::{
        electron_compatible_platform, is_loopback_runtime_config, validate_pending_action,
        PendingWindowAction,
    };

    #[test]
    fn close_action_requires_exact_unconsumed_main_window_nonce() {
        let pending = PendingWindowAction::default();
        let id = uuid::Uuid::new_v4().to_string();
        *pending.0.lock().unwrap() = Some(id.clone());
        assert!(validate_pending_action(&pending, &uuid::Uuid::new_v4().to_string()).is_err());
        assert!(validate_pending_action(&pending, &id).is_ok());
        assert!(validate_pending_action(&pending, &id).is_err());
    }

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
