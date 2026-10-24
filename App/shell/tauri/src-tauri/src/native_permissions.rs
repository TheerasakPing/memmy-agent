//! Tauri-native, privacy-preserving Computer History OS boundaries.
use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

pub struct ComputerHistorySession(String);
impl Default for ComputerHistorySession {
    fn default() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
}
fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Computer History actions require main window".into())
    }
}
#[tauri::command]
pub fn desktop_get_computer_history_permission_session_id(
    window: WebviewWindow,
    session: tauri::State<'_, ComputerHistorySession>,
) -> Result<String, String> {
    require_main(&window)?;
    Ok(session.0.clone())
}
fn probe_full_disk_paths<F>(home: &Path, mut open: F) -> bool
where
    F: FnMut(&Path) -> std::io::Result<()>,
{
    for relative in [
        "Library/Application Support/com.apple.TCC/TCC.db",
        "Library/Safari/Bookmarks.plist",
        "Library/Mail",
    ] {
        match open(&home.join(relative)) {
            Ok(()) => return true,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(_) => return false,
        }
    }
    false
}
#[tauri::command]
pub fn desktop_get_full_disk_access_status(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    require_main(&window)?;
    if !cfg!(target_os = "macos") {
        return Ok(true);
    } // Electron contract on non-macOS.
    let home = app.path().home_dir().map_err(|_| "home path unavailable")?;
    Ok(probe_full_disk_paths(&home, |candidate| {
        let _file = File::open(candidate)?;
        Ok(())
    }))
}
fn approved_markdown_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    if input.is_empty() || input.len() > 4096 || input.chars().any(|c| c.is_control()) {
        return Err("invalid Computer History Markdown file".into());
    }
    let path = Path::new(input);
    let name = path.file_name().ok_or("Markdown file name missing")?;
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !v.eq_ignore_ascii_case("md"))
        || path.parent() != Some(root)
        || root.join(name) != path
    {
        return Err("Markdown must be a direct child of the native history store".into());
    }
    // Refuse all symlink ancestors; this path is privately created by managed Agent.
    let mut current = PathBuf::new();
    for part in root.components() {
        current.push(part);
        let info = fs::symlink_metadata(&current).map_err(|_| "history directory unavailable")?;
        if info.file_type().is_symlink() {
            return Err("history directory symlink refused".into());
        }
    }
    let info = fs::symlink_metadata(path).map_err(|_| "Markdown file unavailable")?;
    if !info.is_file() || info.file_type().is_symlink() || info.len() > 16 * 1024 * 1024 {
        return Err("unsafe Markdown file".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Markdown target unavailable")?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "history directory unavailable")?;
    if canonical.parent() != Some(canonical_root.as_path()) {
        return Err("Markdown target escaped history store".into());
    }
    let mut file = File::open(&canonical).map_err(|_| "Markdown file cannot be opened")?;
    let mut one = [0u8; 1];
    let _ = file
        .read(&mut one)
        .map_err(|_| "Markdown file unreadable")?;
    Ok(canonical)
}
#[tauri::command]
pub fn desktop_open_computer_history_markdown(
    app: AppHandle,
    window: WebviewWindow,
    file_path: String,
) -> Result<(), String> {
    require_main(&window)?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "native data directory unavailable")?
        .join("computer-history")
        .join("histories");
    let approved = approved_markdown_path(&root, &file_path)?;
    app.opener()
        .open_path(approved.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|_| "cannot open Computer History Markdown".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn process_session_id_is_stable_per_instance_and_unique_across_instances() {
        let a = ComputerHistorySession::default();
        let b = ComputerHistorySession::default();
        assert_eq!(uuid::Uuid::parse_str(&a.0).unwrap().get_version_num(), 4);
        assert_ne!(a.0, b.0);
        assert_eq!(a.0, a.0.clone());
    }
    #[test]
    fn full_disk_probes_match_electron_fallback_and_fail_closed() {
        let home = Path::new("/home/example");
        let mut seen = Vec::new();
        let pass = probe_full_disk_paths(home, |p| {
            seen.push(p.to_path_buf());
            if seen.len() < 3 {
                Err(std::io::Error::from(ErrorKind::NotFound))
            } else {
                Ok(())
            }
        });
        assert!(pass);
        assert_eq!(seen.len(), 3);
        assert!(seen[0].ends_with("Library/Application Support/com.apple.TCC/TCC.db"));
        assert!(!probe_full_disk_paths(home, |_| Err(std::io::Error::from(
            ErrorKind::PermissionDenied
        ))));
        assert!(!probe_full_disk_paths(home, |_| Err(std::io::Error::from(
            ErrorKind::NotFound
        ))));
    }
    #[test]
    fn markdown_only_opens_direct_regular_file_inside_private_root() {
        let temp = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("memmy-history-{}", uuid::Uuid::new_v4()));
        let root = temp.join("computer-history").join("histories");
        fs::create_dir_all(&root).unwrap();
        let ok = root.join("summary.md");
        fs::write(&ok, "safe").unwrap();
        assert_eq!(
            approved_markdown_path(&root, ok.to_str().unwrap()).unwrap(),
            ok
        );
        let bad = temp.join("other.md");
        fs::write(&bad, "bad").unwrap();
        assert!(approved_markdown_path(&root, bad.to_str().unwrap()).is_err());
        assert!(approved_markdown_path(&root, root.join("../other.md").to_str().unwrap()).is_err());
        assert!(approved_markdown_path(&root, root.join("bad.txt").to_str().unwrap()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&bad, root.join("link.md")).unwrap();
            assert!(approved_markdown_path(&root, root.join("link.md").to_str().unwrap()).is_err());
        }
        fs::remove_dir_all(temp).unwrap();
    }
}
