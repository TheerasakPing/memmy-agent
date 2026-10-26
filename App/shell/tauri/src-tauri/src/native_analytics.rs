//! Shared, bounded analytics client ID for the managed Tauri Agent process.
//! React gtag obtains consent independently; this command never sends network analytics.
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticsClientInput {
    client_id: String,
    app_env: String,
    app_edition: String,
}

fn validate(input: &AnalyticsClientInput) -> Result<&str, String> {
    let id = input.client_id.trim();
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("analytics client ID format invalid".into());
    }
    if !matches!(input.app_env.as_str(), "dev" | "prod")
        || !matches!(input.app_edition.as_str(), "cn" | "intl")
    {
        return Err("analytics edition or environment invalid".into());
    }
    Ok(id)
}

fn persist_client_id(dir: &Path, input: &AnalyticsClientInput) -> Result<(), String> {
    let id = validate(input)?;
    fs::create_dir_all(dir).map_err(|_| "cannot create managed analytics directory")?;
    let meta = fs::symlink_metadata(dir).map_err(|_| "managed analytics directory unavailable")?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("managed analytics directory is unsafe".into());
    }
    let destination = dir.join("analytics-client-id");
    match fs::symlink_metadata(&destination) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 256 => {
            return Err("analytics client ID destination unsafe".into());
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("analytics client ID destination unreadable".into()),
        _ => {}
    }
    let temp = dir.join(format!("analytics-client-id-{}.tmp", uuid::Uuid::new_v4()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(&temp)
        .map_err(|_| "cannot stage analytics client ID")?;
    let result = file
        .write_all(id.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&temp, &destination));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
        return Err("cannot update managed analytics client ID".into());
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_send_analytics_client_id(
    app: AppHandle,
    window: WebviewWindow,
    payload: AnalyticsClientInput,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only main application window can persist analytics client ID".into());
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "managed Agent data directory unavailable")?;
    persist_client_id(&root, &payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(id: &str) -> AnalyticsClientInput {
        AnalyticsClientInput {
            client_id: id.into(),
            app_env: "prod".into(),
            app_edition: "intl".into(),
        }
    }
    #[test]
    fn persists_current_client_id_for_managed_agent_without_leaking_other_data() {
        let root = std::env::temp_dir().join(format!("memmy-analytics-{}", uuid::Uuid::new_v4()));
        persist_client_id(&root, &input("123.456")).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("analytics-client-id")).unwrap(),
            "123.456\n"
        );
        persist_client_id(&root, &input("234.567")).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("analytics-client-id")).unwrap(),
            "234.567\n"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_malicious_ids_and_symlinked_destinations() {
        let root = std::env::temp_dir().join(format!("memmy-analytics-{}", uuid::Uuid::new_v4()));
        for invalid in [
            "",
            "\n",
            "test\nanother",
            "../../path",
            "https://x",
            "a".repeat(130).as_str(),
        ] {
            assert!(persist_client_id(&root, &input(invalid)).is_err());
        }
        let mut bad_env = input("123.456");
        bad_env.app_env = "something_else".into();
        assert!(persist_client_id(&root, &bad_env).is_err());
        persist_client_id(&root, &input("123.456")).unwrap();
        #[cfg(unix)]
        {
            fs::remove_file(root.join("analytics-client-id")).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", root.join("analytics-client-id")).unwrap();
            assert!(persist_client_id(&root, &input("234.567")).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
