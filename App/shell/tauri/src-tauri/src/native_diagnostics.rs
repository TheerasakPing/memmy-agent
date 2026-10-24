//! Isolated desktop diagnostics. Never follows symlinks or opens arbitrary URLs.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

fn level_path(dir: &Path) -> std::path::PathBuf {
    dir.join("log-level")
}
fn valid_level(value: &str) -> bool {
    matches!(value, "error" | "warn" | "info" | "debug")
}
fn load_level(dir: &Path) -> Result<String, String> {
    let path = level_path(dir);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("info".into()),
        Err(_) => Err("log configuration unavailable".into()),
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 10 => {
            Err("log configuration file is unsafe".into())
        }
        Ok(_) => {
            let level = fs::read_to_string(path).map_err(|_| "cannot read log configuration")?;
            if !valid_level(level.trim()) {
                return Err("saved log level is invalid".into());
            }
            Ok(level.trim().to_owned())
        }
    }
}
fn persist_level(dir: &Path, level: &str) -> Result<(), String> {
    if !valid_level(level) {
        return Err("log level must be error, warn, info, or debug".into());
    }
    fs::create_dir_all(dir).map_err(|_| "cannot prepare native log config")?;
    if fs::symlink_metadata(dir)
        .map_err(|_| "log config directory unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("unsafe config directory symlink".into());
    }
    if let Ok(meta) = fs::symlink_metadata(level_path(dir)) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err("unsafe log level file".into());
        }
    }
    let temp = dir.join(format!("log-level-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|_| "cannot create new log config")?;
    let result = file
        .write_all(level.as_bytes())
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&temp, level_path(dir)));
    if result.is_err() {
        let _ = fs::remove_file(temp);
        return Err("cannot persist log level".into());
    }
    Ok(())
}
fn app_data(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "app local data unavailable".into())
}
#[tauri::command]
pub fn desktop_get_log_level(app: AppHandle) -> Result<String, String> {
    load_level(&app_data(&app)?)
}
#[tauri::command]
pub fn desktop_set_log_level(app: AppHandle, level: String) -> Result<(), String> {
    persist_level(&app_data(&app)?, &level)
}
#[tauri::command]
pub fn desktop_open_logs_directory(app: AppHandle) -> Result<(), String> {
    let dir = app_data(&app)?.join("logs");
    fs::create_dir_all(&dir).map_err(|_| "cannot create private log directory")?;
    let meta = fs::symlink_metadata(&dir).map_err(|_| "cannot inspect log directory")?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("unsafe log directory".into());
    }
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|_| "cannot open native log directory".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn log_level_persists_and_rejects_invalid_values_and_symlinks() {
        let root = std::env::temp_dir().join(format!("memmy-log-config-{}", uuid::Uuid::new_v4()));
        assert_eq!(load_level(&root).unwrap(), "info");
        assert!(persist_level(&root, "trace").is_err());
        persist_level(&root, "debug").unwrap();
        assert_eq!(load_level(&root).unwrap(), "debug");
        #[cfg(unix)]
        {
            fs::remove_file(level_path(&root)).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", level_path(&root)).unwrap();
            assert!(load_level(&root).is_err());
            assert!(persist_level(&root, "info").is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
