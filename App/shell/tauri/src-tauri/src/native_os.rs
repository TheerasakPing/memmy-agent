//! Narrow, explicitly mapped native operations from the legacy desktop bridge.
//! No arbitrary filesystem, shell command execution or renderer path input.
use crate::native_workspace::{grant_root, WorkspaceGrants};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

fn read_existing_install_id(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "installation ID not readable")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 128 {
        return Err("installation ID file is unsafe".into());
    }
    let id = fs::read_to_string(path).map_err(|_| "installation ID not readable")?;
    Uuid::parse_str(id.trim()).map_err(|_| "installation ID is invalid")?;
    Ok(id.trim().to_owned())
}

fn persistent_install_id(directory: &Path) -> Result<String, String> {
    fs::create_dir_all(directory).map_err(|_| "cannot prepare application data")?;
    let file = directory.join("installation-id");
    if fs::symlink_metadata(&file).is_ok() {
        return read_existing_install_id(&file);
    }
    let id = Uuid::new_v4().to_string();
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&file) {
        Ok(mut output) => {
            if output.write_all(id.as_bytes()).is_err() || output.sync_all().is_err() {
                let _ = fs::remove_file(&file);
                return Err("cannot persist installation ID".into());
            }
            Ok(id)
        }
        Err(err) if err.kind() == ErrorKind::AlreadyExists => read_existing_install_id(&file),
        Err(_) => Err("cannot create installation ID".into()),
    }
}

#[tauri::command]
pub fn desktop_get_installation_id(app: AppHandle) -> Result<String, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "app data unavailable")?;
    persistent_install_id(&directory)
}

#[tauri::command]
pub fn desktop_get_launch_at_login(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|_| "autostart state unavailable".into())
}

#[tauri::command]
pub fn desktop_set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|_| "cannot enable autostart")?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|_| "cannot disable autostart")?;
    }
    desktop_get_launch_at_login(app)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotification {
    title: String,
    body: String,
    silent: bool,
    #[serde(default)]
    delivery_id: Option<String>,
}

fn send_notification(app: &AppHandle, payload: NativeNotification) -> Result<(), String> {
    if payload.title.trim().is_empty() || payload.title.len() > 256 || payload.body.len() > 4096 {
        return Err("notification length is invalid".into());
    }
    // The delivery ID is metadata, not an instruction to execute/route anything.
    let _ = &payload.delivery_id;
    let mut note = app
        .notification()
        .builder()
        .title(payload.title)
        .body(payload.body);
    if payload.silent {
        note = note.silent();
    }
    note.show()
        .map_err(|_| "notification could not be displayed".into())
}

#[tauri::command]
pub fn desktop_notify_task_done(app: AppHandle, payload: NativeNotification) -> Result<(), String> {
    send_notification(&app, payload)
}

#[tauri::command]
pub fn desktop_notify_update_available(
    app: AppHandle,
    payload: NativeNotification,
) -> Result<(), String> {
    send_notification(&app, payload)
}

#[tauri::command]
pub async fn desktop_select_project_directory(
    app: AppHandle,
    grants: tauri::State<'_, WorkspaceGrants>,
) -> Result<serde_json::Value, String> {
    let path =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| "folder dialog failed")?;
    match path {
        None => Ok(serde_json::json!({"canceled": true})),
        Some(folder) => {
            let folder = folder
                .into_path()
                .map_err(|_| "selected path was not a local folder")?;
            grant_root(&grants, &folder)?;
            Ok(serde_json::json!({"canceled": false, "path": folder.to_string_lossy()}))
        }
    }
}

#[tauri::command]
pub async fn desktop_select_empty_project_directory(
    app: AppHandle,
    grants: tauri::State<'_, WorkspaceGrants>,
) -> Result<serde_json::Value, String> {
    // Legacy selector allows existing folders; emptiness belongs to the
    // original renderer workflow, not to a silently changed native picker.
    desktop_select_project_directory(app, grants).await
}

#[cfg(test)]
mod tests {
    use super::{persistent_install_id, read_existing_install_id};
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn installation_id_is_stable_and_refuses_symlinks_or_corruption() {
        let root = std::env::temp_dir().join(format!("memmy-native-id-{}", Uuid::new_v4()));
        let result = (|| {
            let a = persistent_install_id(&root).unwrap();
            assert_eq!(a, persistent_install_id(&root).unwrap());
            Uuid::parse_str(&a).unwrap();
            fs::write(root.join("installation-id"), "tampered").unwrap();
            assert!(persistent_install_id(&root).is_err());
            fs::remove_file(root.join("installation-id")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                symlink("/etc/hosts", root.join("installation-id")).unwrap();
                assert!(read_existing_install_id(&root.join("installation-id")).is_err());
            }
        })();
        let _ = fs::remove_dir_all(&root);
        result
    }
}
