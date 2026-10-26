//! Memmy Turbo Tauri 2 shell. All sensitive native operations are explicitly
//! routed through typed, auditable Rust commands; no generic shell invoke.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
mod native_agent_tool;
mod native_analytics;
mod native_approvals;
mod native_browser;
mod native_browser_extension;
mod native_browser_inventory;
mod native_browser_store;
mod native_browser_surface;
mod native_cli_install;
mod native_diagnostics;
mod native_file_export;
mod native_memory_export;
mod native_os;
mod native_permissions;
mod native_pet;
mod native_runtime;
mod native_signed_updater;
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

/// A debug .app is still a packaged application. Detect actual bundled
/// resources, not Rust optimization profile. Only unbundled source development
/// may use repo paths when runtime/ is entirely absent.
fn select_native_runtime_root(
    resources: &Path,
    allow_source_fallback: bool,
) -> Result<Option<PathBuf>, String> {
    let root = resources.join("runtime");
    let info = match std::fs::symlink_metadata(&root) {
        Ok(info) => info,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound && allow_source_fallback => {
            return Ok(None)
        }
        Err(_) => return Err("bundled native runtime folder unavailable".into()),
    };
    if info.file_type().is_symlink() || !info.is_dir() {
        return Err("bundled native runtime must be a real directory".into());
    }
    for entry in [
        if cfg!(windows) { "node.exe" } else { "node" },
        "App/shell/tauri/sidecar/memory.mjs",
        "App/shell/tauri/sidecar/backend.mjs",
        "App/shell/tauri/sidecar/gateway.mjs",
        "Memory/dist/src/server/index.js",
        "App/backend/dist/src/index.js",
        "App/memmy-agent/dist/main.js",
    ] {
        let path = root.join(entry);
        let info =
            std::fs::symlink_metadata(path).map_err(|_| "bundled native runtime is incomplete")?;
        if info.file_type().is_symlink() || !info.is_file() {
            return Err("bundled native runtime entrypoint is unsafe".into());
        }
    }
    Ok(Some(root))
}
fn app_native_runtime_root(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let resources = match app.path().resource_dir() {
        Ok(resources) => resources,
        Err(_) if cfg!(debug_assertions) => return Ok(None),
        Err(_) => return Err("native resource directory unavailable".into()),
    };
    select_native_runtime_root(&resources, cfg!(debug_assertions))
}

/// Opt-in and allowlisted renderer startup telemetry. No renderer-controlled paths or payloads.
#[tauri::command]
fn desktop_record_startup_mark(app: AppHandle, window: WebviewWindow, phase: String, elapsed_ms: f64) -> Result<(), String> {
    if std::env::var("MEMMY_TAURI_PROFILE_STARTUP").as_deref() != Ok("1") { return Ok(()); }
    if window.label() != "main" { return Err("main window only".into()); }
    if !matches!(phase.as_str(), "renderer-module-loaded" | "renderer-first-dom-frame" | "route-ready-first-frame")
        || !elapsed_ms.is_finite() || !(0.0..=300_000.0).contains(&elapsed_ms) {
        return Err("invalid startup metric".into());
    }
    let directory = app.path().app_local_data_dir().map_err(|_| "app data unavailable")?;
    std::fs::create_dir_all(&directory).map_err(|_| "cannot create profile directory")?;
    use std::io::Write as _;
    let mut file = std::fs::OpenOptions::new().create(true).append(true)
        .open(directory.join("startup-performance.log"))
        .map_err(|_| "cannot write performance log")?;
    writeln!(file, "phase={phase} elapsed_ms={elapsed_ms:.1}").map_err(|_| "cannot record performance metric".into())
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
    let bundled_root = app_native_runtime_root(&app)?;
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
        "isPackaged": app_native_runtime_root(&app).ok().flatten().is_some(),
        "isWindowsStore": false
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

#[tauri::command]
async fn desktop_restart_memory_service(
    window: WebviewWindow,
    supervisor: tauri::State<'_, Arc<native_runtime::NativeRuntime>>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Memory restart requires first-party main app window".into());
    }
    let runtime = supervisor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.restart_memory())
        .await
        .map_err(|_| "native Memory restart worker unavailable".to_string())?
}

/// Validate an installed macOS preview without the GUI or production user data.
/// This intentionally requires a real bundle and launches all three services.
/// Resolve installed resources from the platform's actual installer layout.
/// macOS: Foo.app/Contents/MacOS/Foo => Contents/Resources/runtime
/// Windows: installation/Foo.exe => installation/runtime (NSIS or MSI).
fn native_resources_for_executable(exe: &Path) -> Option<PathBuf> {
    let bin = exe.parent()?;
    #[cfg(target_os = "macos")]
    {
        Some(bin.parent()?.join("Resources/runtime"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(bin.join("runtime"))
    }
}

pub fn smoke_installed_runtime() -> i32 {
    let result = (|| -> Result<(), String> {
        let executable =
            std::env::current_exe().map_err(|_| "cannot resolve packaged executable")?;
        let resources = native_resources_for_executable(&executable)
            .ok_or("native Tauri executable has no runtime resource directory")?;
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

#[tauri::command]
fn desktop_debug_renderer_status(
    window: WebviewWindow,
    tauri_available: bool,
    bridge_available: bool,
    react_root_rendered: bool,
    dom_text_length: usize,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("GUI diagnostics require first-party main window".into());
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "[memmy-preview-gui] js probe: tauri={tauri_available}, bridge={bridge_available}, react_root={react_root_rendered}, text_bytes={dom_text_length}"
    );
    #[cfg(not(debug_assertions))]
    let _ = (
        tauri_available,
        bridge_available,
        react_root_rendered,
        dom_text_length,
    );
    Ok(())
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
        .manage(native_signed_updater::SignedUpdaterState::default())
        // Public key is a build-time pinned trust root. Empty key disables native
        // update discovery and all package operations, never enables unsigned.
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(option_env!("MEMMY_TAURI_UPDATER_PUBLIC_KEY").unwrap_or(""))
                .build(),
        )
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
        .on_page_load(|webview, payload| {
            #[cfg(debug_assertions)]
            if webview.label() == "main" {
                eprintln!("[memmy-preview-gui] page load: {:?}", payload.event());
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    let _ = webview.eval(r##"
                      // Send counts only, never renderer text or private account data.
                      const probe = () => {
                        const bridge = window.__TAURI__?.core?.invoke
                          || window.__TAURI_INTERNALS__?.invoke;
                        if (bridge) Promise.resolve(bridge("desktop_debug_renderer_status", {
                          tauriAvailable: Boolean(window.__TAURI__?.core),
                          bridgeAvailable: Boolean(window.memmy?.getRuntimeConfig),
                          reactRootRendered: Boolean(document.querySelector("#root")?.firstElementChild),
                          domTextLength: document.querySelector("#root")?.textContent?.length || 0
                        })).catch(() => {});
                      };
                      [3500, 30000, 70000].forEach(delay => setTimeout(probe, delay));
                    "##);
                }
            }
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
            desktop_debug_renderer_status,
            desktop_runtime_config,
            desktop_record_startup_mark,
            desktop_app_info,
            native_signed_updater::desktop_signed_check_for_updates,
            native_signed_updater::desktop_signed_download_update,
            native_signed_updater::desktop_signed_open_update_installer,
            desktop_open_external,
            desktop_fullscreen,
            desktop_complete_window_action,
            native_os::desktop_notify_task_done,
            native_os::desktop_notify_update_available,
            native_os::desktop_get_launch_at_login,
            native_os::desktop_set_launch_at_login,
            native_os::desktop_get_installation_id,
            native_analytics::desktop_send_analytics_client_id,
            native_memory_export::desktop_export_memory_database,
            native_cli_install::desktop_install_cli_tools,
            native_agent_tool::desktop_open_agent_tool,
            desktop_restart_memory_service,
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
            native_browser::desktop_native_browser_mark_user_navigation,
            native_browser::desktop_native_browser_copy_tab_url,
            desktop_get_browser_sidebar_surface,
            desktop_send_browser_sidebar_action,
            native_browser_store::desktop_get_browser_history,
            native_browser_store::desktop_clear_browser_data,
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
        electron_compatible_platform, is_loopback_runtime_config, select_native_runtime_root,
        validate_pending_action, PendingWindowAction,
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
    fn packaged_debug_app_never_falls_back_to_developer_source_if_runtime_exists() {
        let base =
            std::env::temp_dir().join(format!("memmy-runtime-detect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        assert!(select_native_runtime_root(&base, true).unwrap().is_none());
        assert!(select_native_runtime_root(&base, false).is_err());
        let runtime = base.join("runtime");
        std::fs::create_dir(&runtime).unwrap();
        assert!(select_native_runtime_root(&base, true).is_err());
        for entry in [
            if cfg!(windows) { "node.exe" } else { "node" },
            "App/shell/tauri/sidecar/memory.mjs",
            "App/shell/tauri/sidecar/backend.mjs",
            "App/shell/tauri/sidecar/gateway.mjs",
            "Memory/dist/src/server/index.js",
            "App/backend/dist/src/index.js",
            "App/memmy-agent/dist/main.js",
        ] {
            let path = runtime.join(entry);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"compiled entrypoint test fixture").unwrap();
        }
        assert_eq!(
            select_native_runtime_root(&base, true).unwrap(),
            Some(runtime.clone())
        );
        assert_eq!(
            select_native_runtime_root(&base, false).unwrap(),
            Some(runtime.clone())
        );
        #[cfg(unix)]
        {
            let payload = runtime.join("App/backend/dist/src/index.js");
            std::fs::remove_file(&payload).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", &payload).unwrap();
            assert!(select_native_runtime_root(&base, true).is_err());
            std::fs::remove_dir_all(&runtime).unwrap();
            std::os::unix::fs::symlink("/tmp", &runtime).unwrap();
            assert!(select_native_runtime_root(&base, true).is_err());
        }
        std::fs::remove_dir_all(&base).unwrap();
    }

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
