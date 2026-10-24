//! Explicit, user-confirmed native file exports. No renderer-supplied filesystem paths.
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    #[serde(default)]
    url: String,
    name: Option<String>,
    #[allow(dead_code)]
    mime: Option<String>,
    data: Option<Vec<u8>>,
}

fn basename(name: Option<&str>, url: &str, fallback: &str) -> String {
    let source = name
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| url.split(['?', '#']).next().unwrap_or(""));
    let segment = source.split(['/', '\\']).next_back().unwrap_or("");
    let clean: String = segment
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .take(96)
        .collect();
    let safe = clean.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if safe.is_empty()
        || matches!(
            safe.to_ascii_uppercase().as_str(),
            "CON" | "PRN" | "AUX" | "NUL"
        )
    {
        fallback.to_owned()
    } else {
        safe.to_owned()
    }
}

fn image_extension(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Ok("png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Ok("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Ok("webp");
    }
    Err("unsupported image payload (PNG, JPEG, GIF, WebP only)".into())
}

fn checked_payload(request: &SaveRequest, image: bool) -> Result<(Vec<u8>, String), String> {
    let bytes = request
        .data
        .as_ref()
        .ok_or("downloaded bytes are required; URL-only exports are not yet supported in Tauri")?;
    if bytes.is_empty() || bytes.len() > MAX_EXPORT_BYTES {
        return Err("export payload must be between 1 byte and 64 MiB".into());
    }
    let name = if image {
        let ext = image_extension(bytes)?;
        let original = basename(request.name.as_deref(), &request.url, "image");
        Path::new(&original)
            .with_extension(ext)
            .to_string_lossy()
            .into_owned()
    } else {
        basename(request.name.as_deref(), &request.url, "download.bin")
    };
    Ok((bytes.clone(), name))
}

fn persist_user_selection(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !path.is_absolute() || path.file_name().is_none() {
        return Err("save destination must be selected by the native picker".into());
    }
    // A sibling temp file + rename avoids following an existing destination symlink.
    let parent = path.parent().ok_or("save destination has no parent")?;
    let tmp: PathBuf = parent.join(format!(".memmy-save-{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&tmp)
        .map_err(|_| "unable to create save temp file")?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return Err("unable to save selected file".into());
    }
    Ok(())
}

fn native_save(
    app: &AppHandle,
    window: &WebviewWindow,
    request: SaveRequest,
    image: bool,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("only the main desktop window can export a file".into());
    }
    let (bytes, name) = checked_payload(&request, image)?;
    let mut dialog = app.dialog().file().set_file_name(name);
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    if image {
        dialog = dialog.add_filter("Image", &["png", "jpg", "jpeg", "gif", "webp"]);
    }
    let selected = dialog.blocking_save_file();
    let Some(path) = selected else {
        return Ok(json!({"canceled": true}));
    };
    let path = path
        .into_path()
        .map_err(|_| "save picker did not return a local path")?;
    persist_user_selection(&path, &bytes)?;
    Ok(json!({"canceled": false, "filePath": path.to_string_lossy(), "bytes": bytes.len()}))
}

#[tauri::command]
pub fn desktop_save_file(
    app: AppHandle,
    window: WebviewWindow,
    request: SaveRequest,
) -> Result<Value, String> {
    native_save(&app, &window, request, false)
}

#[tauri::command]
pub fn desktop_save_image(
    app: AppHandle,
    window: WebviewWindow,
    request: SaveRequest,
) -> Result<Value, String> {
    native_save(&app, &window, request, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn req(data: Option<Vec<u8>>, name: &str) -> SaveRequest {
        SaveRequest {
            url: "https://example.test/file".into(),
            name: Some(name.into()),
            mime: None,
            data,
        }
    }
    #[test]
    fn export_requires_actual_bounded_bytes() {
        assert!(checked_payload(&req(None, "foo.txt"), false).is_err());
        assert!(checked_payload(&req(Some(vec![]), "foo.txt"), false).is_err());
        assert!(
            checked_payload(&req(Some(vec![2; MAX_EXPORT_BYTES + 1]), "foo.txt"), false).is_err()
        );
        assert_eq!(
            checked_payload(&req(Some(b"hi".to_vec()), "foo.txt"), false)
                .unwrap()
                .1,
            "foo.txt"
        );
    }
    #[test]
    fn filename_never_trusts_renderer_directories() {
        assert_eq!(
            basename(Some("../../private/key.txt"), "", "fallback"),
            "key.txt"
        );
        assert_eq!(
            basename(Some(r"..\private\key.txt"), "", "fallback"),
            "key.txt"
        );
        assert_eq!(
            basename(Some("C:\\some\\folder\\secret|.txt"), "", "fallback"),
            "secret.txt"
        );
        assert_eq!(basename(Some(".."), "", "fallback"), "fallback");
    }
    #[test]
    fn images_are_sniffed_not_trusted_by_declared_mime_or_extension() {
        let png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0];
        let save = req(Some(png), "mislabelled.svg");
        assert_eq!(checked_payload(&save, true).unwrap().1, "mislabelled.png");
        assert!(checked_payload(&req(Some(b"<svg />".to_vec()), "image.png"), true).is_err());
    }
    #[test]
    fn persist_is_atomic_and_writes_real_bytes() {
        let folder = std::env::temp_dir().join(format!("memmy-native-save-{}", Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let target = folder.join("export.txt");
        persist_user_selection(&target, b"hello").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"hello");
        #[cfg(unix)]
        {
            let link = folder.join("link.txt");
            std::os::unix::fs::symlink(&target, &link).unwrap();
            persist_user_selection(&link, b"new").unwrap();
            assert_eq!(fs::read(&target).unwrap(), b"hello");
            assert_eq!(fs::read(&link).unwrap(), b"new");
        }
        fs::remove_dir_all(folder).unwrap();
    }
}
