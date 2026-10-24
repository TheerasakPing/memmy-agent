//! Shared native approval preferences consumed by the managed Agent Gateway.
//! Default-deny on corrupt data; webview may only change values from the main
//! window. Stores are *not* evidence of fully working Computer Use or Browser.
use crate::native_browser_store::{atomic_json, browser_folder, check_data_file};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[derive(Default)]
pub struct ApprovalLock(Mutex<()>);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ApprovalDocument {
    version: u8,
    enabled: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BrowserApprovalState {
    enabled: bool,
    inherited: bool,
    effective: bool,
}

fn read_grant(path: &Path) -> bool {
    if !matches!(check_data_file(path, 4096), Ok(true)) {
        return false;
    }
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ApprovalDocument>(&bytes).ok())
        .is_some_and(|value| value.version == 1 && value.enabled)
}

fn write_grant(path: &Path, enabled: bool) -> Result<(), String> {
    atomic_json(
        path,
        &ApprovalDocument {
            version: 1,
            enabled,
        },
        4096,
    )
}

fn native_file(app: &AppHandle) -> Result<PathBuf, String> {
    let browser = browser_folder(app)?;
    Ok(browser
        .parent()
        .ok_or("application data root unavailable")?
        .join("computer-use/allow-all-apps.json"))
}

fn browser_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(browser_folder(app)?.join("allow-all-websites.json"))
}

fn current(browser: &Path, native: &Path) -> BrowserApprovalState {
    let enabled = read_grant(browser);
    let inherited = read_grant(native);
    BrowserApprovalState {
        enabled,
        inherited,
        effective: enabled || inherited,
    }
}

fn ensure_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the main window can inspect or update global approval".into());
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_get_native_app_allow_all(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ApprovalLock>,
) -> Result<bool, String> {
    ensure_main(&window)?;
    let _guard = lock.0.lock().map_err(|_| "approval state unavailable")?;
    Ok(read_grant(&native_file(&app)?))
}

#[tauri::command]
pub fn desktop_set_native_app_allow_all(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ApprovalLock>,
    enabled: bool,
) -> Result<bool, String> {
    ensure_main(&window)?;
    let state = {
        let _guard = lock.0.lock().map_err(|_| "approval state unavailable")?;
        write_grant(&native_file(&app)?, enabled)?;
        current(&browser_file(&app)?, &native_file(&app)?)
    };
    app.emit("memmy:browser-allow-all:changed", state)
        .map_err(|_| "failed to publish updated approval")?;
    Ok(enabled)
}

#[tauri::command]
pub fn desktop_get_browser_allow_all(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ApprovalLock>,
) -> Result<BrowserApprovalState, String> {
    ensure_main(&window)?;
    let _guard = lock.0.lock().map_err(|_| "approval state unavailable")?;
    Ok(current(&browser_file(&app)?, &native_file(&app)?))
}

#[tauri::command]
pub fn desktop_set_browser_allow_all(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ApprovalLock>,
    enabled: bool,
) -> Result<BrowserApprovalState, String> {
    ensure_main(&window)?;
    let state = {
        let _guard = lock.0.lock().map_err(|_| "approval state unavailable")?;
        write_grant(&browser_file(&app)?, enabled)?;
        current(&browser_file(&app)?, &native_file(&app)?)
    };
    app.emit("memmy:browser-allow-all:changed", &state)
        .map_err(|_| "failed to publish updated browser approval")?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    fn paths() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("memmy-approval-{}", Uuid::new_v4()));
        let browser = root.join("browser-use/allow-all-websites.json");
        let native = root.join("computer-use/allow-all-apps.json");
        (root, browser, native)
    }
    #[test]
    fn default_is_deny_and_native_consent_is_inherited() {
        let (root, browser, native) = paths();
        assert_eq!(
            current(&browser, &native),
            BrowserApprovalState {
                enabled: false,
                inherited: false,
                effective: false
            }
        );
        write_grant(&browser, true).unwrap();
        assert!(current(&browser, &native).effective);
        write_grant(&browser, false).unwrap();
        assert!(!current(&browser, &native).effective);
        write_grant(&native, true).unwrap();
        assert_eq!(
            current(&browser, &native),
            BrowserApprovalState {
                enabled: false,
                inherited: true,
                effective: true
            }
        );
        write_grant(&native, false).unwrap();
        assert!(!current(&browser, &native).effective);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_oversized_and_symlinked_grants_fail_closed() {
        let (root, browser, native) = paths();
        fs::create_dir_all(browser.parent().unwrap()).unwrap();
        for raw in [
            "{}",
            "null",
            "true",
            "{\"enabled\":true}",
            "{\"version\":2,\"enabled\":true}",
            "{\"version\":1,\"enabled\":\"true\"}",
            "{\"version\":1,\"enabled\":true,\"extra\":true}",
        ] {
            fs::write(&browser, raw).unwrap();
            assert!(!read_grant(&browser), "unsafe approval accepted: {raw}");
        }
        fs::write(&browser, vec![b' '; 4097]).unwrap();
        assert!(!read_grant(&browser));
        #[cfg(unix)]
        {
            fs::remove_file(&browser).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", &browser).unwrap();
            assert!(!read_grant(&browser));
            assert!(write_grant(&browser, true).is_err());
            assert!(!read_grant(&native));
        }
        fs::remove_dir_all(root).unwrap();
    }
}
