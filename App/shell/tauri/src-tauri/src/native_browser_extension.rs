//! Discover the real, packaged MV3 Browser extension, never a renderer-provided folder.
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

fn extension_root(path: &Path) -> Option<PathBuf> {
    let root = path.canonicalize().ok()?;
    let info = fs::symlink_metadata(path).ok()?;
    if info.file_type().is_symlink() || !info.is_dir() {
        return None;
    }
    for file in [
        "manifest.json",
        "background.js",
        "history-content.js",
        "history-sensor.js",
    ] {
        let target = path.join(file);
        let metadata = fs::symlink_metadata(&target).ok()?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 512 * 1024 {
            return None;
        }
    }
    let manifest = fs::read(path.join("manifest.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest).ok()?;
    if manifest["manifest_version"] != 3
        || manifest["name"]
            .as_str()
            .is_none_or(|name| name.trim().is_empty())
        || manifest["version"]
            .as_str()
            .is_none_or(|version| version.trim().is_empty())
    {
        return None;
    }
    // A valid directory alone does not prove extension installation or authorization.
    Some(root)
}

fn locate_extension(app: &AppHandle) -> Option<PathBuf> {
    let resource = app.path().resource_dir().ok()?.join("browser-extension");
    if let Some(found) = extension_root(&resource) {
        return Some(found);
    }
    #[cfg(debug_assertions)]
    {
        // Dev-only location in this checkout, never searched from a packaged release.
        let dev =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../desktop/extensions/memmy-browser");
        return extension_root(&dev);
    }
    #[cfg(not(debug_assertions))]
    None
}

#[tauri::command]
pub fn desktop_get_browser_extension_directory(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("extension location requires main window".into());
    }
    Ok(locate_extension(&app).map(|folder| folder.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn desktop_reveal_browser_extension(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("extension reveal requires main window".into());
    }
    let Some(folder) = locate_extension(&app) else {
        return Ok(false);
    };
    app.opener()
        .open_path(folder.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|_| "failed to show bundled browser extension".to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_mv3_extension_with_expected_assets_is_accepted() {
        let temp = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("memmy-ext-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).unwrap();
        assert!(extension_root(&temp).is_none());
        let manifest = r#"{"manifest_version":3,"name":"Memmy Browser","version":"1.0.0"}"#;
        fs::write(temp.join("manifest.json"), manifest).unwrap();
        for name in ["background.js", "history-content.js", "history-sensor.js"] {
            fs::write(temp.join(name), "// verified").unwrap();
        }
        assert_eq!(extension_root(&temp), Some(temp.clone()));
        fs::write(
            temp.join("manifest.json"),
            r#"{"manifest_version":2,"name":"fake","version":"1.0"}"#,
        )
        .unwrap();
        assert!(extension_root(&temp).is_none());
        fs::write(temp.join("manifest.json"), manifest).unwrap();
        #[cfg(unix)]
        {
            fs::remove_file(temp.join("background.js")).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", temp.join("background.js")).unwrap();
            assert!(extension_root(&temp).is_none());
        }
        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn bundled_source_manifest_remains_mv3_with_required_assets() {
        let dev =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../desktop/extensions/memmy-browser");
        assert!(extension_root(&dev).is_some());
    }
}
