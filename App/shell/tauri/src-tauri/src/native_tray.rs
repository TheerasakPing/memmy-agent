//! Native tray/menu bar icon. Unlike Electron IPC, no hidden renderer shell
//! commands: the icon is created using Tauri's platform tray APIs.
use std::sync::Mutex;
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct TrayState {
    icon: Mutex<Option<TrayIcon>>,
}

#[tauri::command]
pub fn desktop_set_menu_bar_icon(
    app: AppHandle,
    state: State<'_, TrayState>,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let mut locked = state
        .icon
        .lock()
        .map_err(|_| "menu bar icon state unavailable")?;
    if enabled && locked.is_none() {
        let icon = app
            .default_window_icon()
            .ok_or("native app icon unavailable")?
            .clone();
        let tray = TrayIconBuilder::with_id("memmy-main-tray")
            .icon(icon)
            .tooltip("Memmy Turbo")
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { .. } = event {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })
            .build(&app)
            .map_err(|_| "native tray icon could not be created")?;
        *locked = Some(tray);
    } else if !enabled {
        // Dropping our last icon handle removes the icon from the OS tray.
        *locked = None;
    }
    Ok(serde_json::json!({"enabled":locked.is_some()}))
}

#[derive(serde::Deserialize)]
pub struct RecordingIndicator {
    enabled: bool,
    recording: bool,
}

#[tauri::command]
pub fn desktop_set_computer_history_tray_indicator(
    state: State<'_, TrayState>,
    indicator: RecordingIndicator,
) -> Result<(), String> {
    let locked = state
        .icon
        .lock()
        .map_err(|_| "tray indicator unavailable")?;
    if let Some(icon) = locked.as_ref() {
        let tooltip = match (indicator.enabled, indicator.recording) {
            (true, true) => "Memmy Turbo · Computer History recording",
            (true, false) => "Memmy Turbo · Computer History enabled",
            _ => "Memmy Turbo",
        };
        icon.set_tooltip(Some(tooltip))
            .map_err(|_| "cannot update tray recording indicator")?;
    }
    Ok(())
}
