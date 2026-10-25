//! Tauri-owned Browser History and origin permission stores.
//! These commands preserve the Electron renderer's data contract, but do NOT
//! claim an embedded browser or Computer Use implementation exists yet.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

static HISTORY_IO: Mutex<()> = Mutex::new(());
const HISTORY_LIMIT: usize = 500;
const HISTORY_BYTES: u64 = 4 * 1024 * 1024;
const PERMISSION_LIMIT: usize = 200;
const PERMISSION_BYTES: u64 = 128 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    url: String,
    title: String,
    visited_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    visit_source: Option<String>,
}

fn valid_web_url(raw: &str) -> bool {
    if raw.len() > 4096 {
        return false;
    }
    url::Url::parse(raw).is_ok_and(|uri| {
        matches!(uri.scheme(), "https" | "http")
            && uri.host_str().is_some()
            && uri.username().is_empty()
            && uri.password().is_none()
    })
}

fn valid_entry(entry: &HistoryEntry) -> bool {
    valid_web_url(&entry.url)
        && entry.title.len() <= 256
        && entry.visited_at.is_finite()
        && entry.id.as_ref().is_none_or(|v| Uuid::parse_str(v).is_ok())
        && entry
            .visit_source
            .as_deref()
            .is_none_or(|v| matches!(v, "agent" | "other"))
}

fn safe_parent(folder: &Path) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|_| "cannot prepare browser data directory")?;
    let metadata =
        fs::symlink_metadata(folder).map_err(|_| "cannot inspect browser data folder")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("browser data folder must be a real directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(folder, fs::Permissions::from_mode(0o700))
            .map_err(|_| "unable to protect browser data directory")?;
    }
    Ok(())
}

pub(crate) fn check_data_file(path: &Path, limit: u64) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(info) => {
            if info.file_type().is_symlink() || !info.is_file() || info.len() > limit {
                return Err("browser data file has unsafe type or size".into());
            }
            Ok(true)
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err("browser data file not accessible".into()),
    }
}

fn load_history(path: &Path) -> Result<Vec<HistoryEntry>, String> {
    if !check_data_file(path, HISTORY_BYTES)? {
        return Ok(vec![]);
    }
    let bytes = fs::read(path).map_err(|_| "cannot load browser history")?;
    let raw: Vec<HistoryEntry> =
        serde_json::from_slice(&bytes).map_err(|_| "browser history data is corrupted")?;
    if raw.len() > HISTORY_LIMIT || raw.iter().any(|v| !valid_entry(v)) {
        return Err("browser history contains untrusted entries".into());
    }
    Ok(raw
        .into_iter()
        .map(|mut entry| {
            entry.id.get_or_insert_with(|| Uuid::new_v4().to_string());
            entry.visit_source.get_or_insert_with(|| "other".to_owned());
            entry
        })
        .collect())
}

pub(crate) fn atomic_json<T: Serialize>(
    path: &Path,
    content: &T,
    limit: u64,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(content).map_err(|_| "could not encode browser data")?;
    if bytes.len() as u64 > limit {
        return Err("browser store would exceed size budget".into());
    }
    let folder = path.parent().ok_or("browser data folder unavailable")?;
    safe_parent(folder)?;
    let _ = check_data_file(path, limit)?; // Refuse replacing symlinks/devices.
    let temp = folder.join(format!(".memmy-browser-{}.tmp", Uuid::new_v4()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| -> Result<(), String> {
        let mut file = opts
            .open(&temp)
            .map_err(|_| "browser temporary file unavailable")?;
        file.write_all(&bytes)
            .map_err(|_| "failed to write browser store")?;
        file.sync_all()
            .map_err(|_| "failed to sync browser store")?;
        // Check the target a final time. The remaining same-directory rename
        // race must be independently reviewed before production signoff.
        let _ = check_data_file(path, limit)?;
        fs::rename(&temp, path).map_err(|_| "could not commit browser store".to_string())
    })();
    let _ = fs::remove_file(&temp);
    result
}

pub(crate) fn browser_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let parent = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "native app data directory missing")?;
    safe_parent(&parent)?;
    let browser = parent.join("browser-use");
    safe_parent(&browser)?;
    Ok(browser)
}

fn import_legacy(path: &Path, incoming: Vec<HistoryEntry>) -> Result<bool, String> {
    if incoming.len() > HISTORY_LIMIT || incoming.iter().any(|v| !valid_entry(v)) {
        return Ok(false);
    }
    if serde_json::to_vec(&incoming).map_or(true, |v| v.len() as u64 > HISTORY_BYTES) {
        return Ok(false);
    }
    let mut current = load_history(path)?;
    let known: HashSet<String> = current
        .iter()
        .map(|v| format!("{}\0{}\0{}", v.url, v.title, v.visited_at))
        .collect();
    let mut latest: HashMap<String, HistoryEntry> = HashMap::new();
    for entry in incoming {
        if latest
            .get(&entry.url)
            .is_none_or(|v| entry.visited_at > v.visited_at)
        {
            latest.insert(entry.url.clone(), entry);
        }
    }
    let mut changed = false;
    for (_, mut entry) in latest {
        if known.contains(&format!(
            "{}\0{}\0{}",
            entry.url, entry.title, entry.visited_at
        )) {
            continue;
        }
        entry.id.get_or_insert_with(|| Uuid::new_v4().to_string());
        entry.visit_source.get_or_insert_with(|| "other".to_owned());
        current.push(entry);
        changed = true;
    }
    if changed {
        current.sort_by(|a, b| b.visited_at.total_cmp(&a.visited_at));
        current.truncate(HISTORY_LIMIT);
        atomic_json(path, &current, HISTORY_BYTES)?;
    }
    Ok(true)
}

/// Persist actual Tauri child WebView page loads instead of silently leaving
/// the legacy import-only history store empty on newly visited pages.
pub(crate) fn record_native_visit(
    path: &Path,
    url: &str,
    title: &str,
    source: &str,
) -> Result<bool, String> {
    if !valid_web_url(url) || source != "other" {
        return Ok(false); // Native WebKit is NOT the Agent Playwright context.
    }
    let _guard = HISTORY_IO
        .lock()
        .map_err(|_| "browser history writer unavailable")?;
    let mut history = load_history(path)?;
    let id = history
        .iter()
        .find(|entry| entry.url == url)
        .and_then(|entry| entry.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    history.retain(|entry| entry.url != url);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock unavailable for browser visit")?
        .as_millis() as f64;
    history.insert(
        0,
        HistoryEntry {
            id: Some(id),
            url: url.to_string(),
            title: title.chars().take(256).collect(),
            visited_at: stamp,
            visit_source: Some("other".into()),
        },
    );
    history.truncate(HISTORY_LIMIT);
    atomic_json(path, &history, HISTORY_BYTES)?;
    Ok(true)
}

fn remove_one(path: &Path, id_or_url: &str) -> Result<bool, String> {
    if id_or_url.len() > 4096 {
        return Ok(false);
    }
    let mut entries = load_history(path)?;
    let initial = entries.len();
    let is_id = Uuid::parse_str(id_or_url).is_ok();
    entries.retain(|entry| {
        entry.id.as_deref() != Some(id_or_url) && (is_id || entry.url != id_or_url)
    });
    if initial == entries.len() {
        return Ok(false);
    }
    atomic_json(path, &entries, HISTORY_BYTES)?;
    Ok(true)
}

fn remove_selected(path: &Path, selectors: &[String]) -> Result<usize, String> {
    if selectors.is_empty()
        || selectors.len() > HISTORY_LIMIT
        || selectors
            .iter()
            .any(|v| v.len() > 4096 || !(Uuid::parse_str(v).is_ok() || valid_web_url(v)))
    {
        return Ok(0);
    }
    let selected: HashSet<&str> = selectors.iter().map(String::as_str).collect();
    let mut entries = load_history(path)?;
    let initial = entries.len();
    entries.retain(|entry| {
        !selected.contains(entry.id.as_deref().unwrap_or(""))
            && !selected.contains(entry.url.as_str())
    });
    if initial == entries.len() {
        return Ok(0);
    }
    atomic_json(path, &entries, HISTORY_BYTES)?;
    Ok(initial - entries.len())
}

#[derive(Deserialize, Serialize)]
pub struct AccessRecord {
    origin: String,
    decision: String,
}

fn valid_origin(raw: &str) -> bool {
    if raw.len() > 320 {
        return false;
    }
    url::Url::parse(raw).is_ok_and(|parsed| {
        matches!(parsed.scheme(), "http" | "https")
            && parsed.origin().ascii_serialization() == raw
            && parsed.username().is_empty()
            && parsed.password().is_none()
    })
}

fn load_access(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !check_data_file(path, PERMISSION_BYTES)? {
        return Ok(BTreeMap::new());
    }
    let bytes = fs::read(path).map_err(|_| "browser permissions unreadable")?;
    let object: BTreeMap<String, String> =
        serde_json::from_slice(&bytes).map_err(|_| "browser permissions are corrupted")?;
    Ok(object
        .into_iter()
        .filter(|(origin, decision)| {
            valid_origin(origin) && matches!(decision.as_str(), "allow" | "deny")
        })
        .take(PERMISSION_LIMIT)
        .collect())
}

fn entries_access(map: &BTreeMap<String, String>) -> Vec<AccessRecord> {
    map.iter()
        .map(|(origin, decision)| AccessRecord {
            origin: origin.clone(),
            decision: decision.clone(),
        })
        .collect()
}

fn set_access(path: &Path, origin: &str, decision: &str) -> Result<Vec<AccessRecord>, String> {
    if !valid_origin(origin) || !matches!(decision, "allow" | "deny" | "ask") {
        return Err("invalid browser access decision".into());
    }
    let mut map = load_access(path)?;
    if decision == "ask" {
        map.remove(origin);
    } else {
        map.insert(origin.to_string(), decision.to_owned());
    }
    if map.len() > PERMISSION_LIMIT {
        return Err("browser permission count exceeded".into());
    }
    atomic_json(path, &map, PERMISSION_BYTES)?;
    Ok(entries_access(&map))
}

/// A directory must come from the OS-native folder picker before it is
/// approved for a future browser download, never from arbitrary renderer JSON.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    directory: Option<String>,
    approved_directories: Vec<String>,
    ask_before_download: bool,
}

fn download_settings(path: &Path) -> Result<DownloadSettings, String> {
    if !check_data_file(path, 64 * 1024)? {
        return Ok(DownloadSettings::default());
    }
    let bytes = fs::read(path).map_err(|_| "download settings not readable")?;
    let stored: DownloadSettings =
        serde_json::from_slice(&bytes).map_err(|_| "download settings corrupted")?;
    let mut approved = Vec::new();
    for candidate in stored
        .approved_directories
        .into_iter()
        .filter(|v| !v.is_empty() && v.len() <= 4096)
    {
        let dir = Path::new(&candidate);
        if !dir.is_absolute() || !dir.is_dir() {
            continue;
        }
        let Ok(canonical) = dir.canonicalize() else {
            continue;
        };
        let canonical = canonical.to_string_lossy().into_owned();
        if !approved.contains(&canonical) {
            approved.push(canonical);
        }
    }
    if approved.len() > 20 {
        approved = approved.split_off(approved.len() - 20);
    }
    let selected = stored.directory.and_then(|value| {
        if approved.iter().any(|approved| approved == &value) {
            Some(value)
        } else {
            None
        }
    });
    Ok(DownloadSettings {
        directory: selected,
        approved_directories: approved,
        ask_before_download: stored.ask_before_download,
    })
}

fn select_download_directory(
    path: &Path,
    directory: Option<&Path>,
) -> Result<DownloadSettings, String> {
    let mut settings = download_settings(path)?;
    settings.directory = match directory {
        None => None,
        Some(candidate) => {
            if !candidate.is_absolute() || !candidate.is_dir() {
                return Err("browser download directory is invalid".into());
            }
            let canonical = candidate
                .canonicalize()
                .map_err(|_| "browser download folder unavailable")?;
            if !canonical.is_dir() {
                return Err("browser download folder is not a directory".into());
            }
            let value = canonical.to_string_lossy().into_owned();
            settings.approved_directories.retain(|v| v != &value);
            settings.approved_directories.push(value.clone());
            if settings.approved_directories.len() > 20 {
                settings
                    .approved_directories
                    .drain(..settings.approved_directories.len() - 20);
            }
            Some(value)
        }
    };
    atomic_json(path, &settings, 64 * 1024)?;
    Ok(settings)
}

#[tauri::command]
pub fn desktop_get_browser_download_settings(app: AppHandle) -> Result<DownloadSettings, String> {
    download_settings(&browser_folder(&app)?.join("download-settings.json"))
}

#[tauri::command]
pub async fn desktop_choose_browser_download_directory(
    app: AppHandle,
) -> Result<DownloadSettings, String> {
    let path = browser_folder(&app)?.join("download-settings.json");
    let selected =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| "native folder chooser failed")?;
    let Some(selected) = selected else {
        return download_settings(&path);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "folder chooser did not return local path")?;
    select_download_directory(&path, Some(&selected))
}

#[tauri::command]
pub fn desktop_reset_browser_download_directory(
    app: AppHandle,
) -> Result<DownloadSettings, String> {
    select_download_directory(&browser_folder(&app)?.join("download-settings.json"), None)
}

#[tauri::command]
pub fn desktop_set_browser_ask_before_download(
    app: AppHandle,
    enabled: bool,
) -> Result<DownloadSettings, String> {
    let path = browser_folder(&app)?.join("download-settings.json");
    let mut settings = download_settings(&path)?;
    settings.ask_before_download = enabled;
    atomic_json(&path, &settings, 64 * 1024)?;
    Ok(settings)
}

#[tauri::command]
pub fn desktop_get_browser_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let _guard = HISTORY_IO
        .lock()
        .map_err(|_| "browser history writer unavailable")?;
    load_history(&browser_folder(&app)?.join("history.json"))
}

#[tauri::command]
pub fn desktop_import_legacy_browser_history(
    app: AppHandle,
    entries: Vec<HistoryEntry>,
) -> Result<bool, String> {
    let _guard = HISTORY_IO
        .lock()
        .map_err(|_| "browser history writer unavailable")?;
    import_legacy(&browser_folder(&app)?.join("history.json"), entries)
}

#[tauri::command]
pub fn desktop_remove_browser_history(app: AppHandle, url: String) -> Result<bool, String> {
    let _guard = HISTORY_IO
        .lock()
        .map_err(|_| "browser history writer unavailable")?;
    remove_one(&browser_folder(&app)?.join("history.json"), &url)
}

#[tauri::command]
pub fn desktop_remove_selected_browser_history(
    app: AppHandle,
    urls: Vec<String>,
) -> Result<usize, String> {
    let _guard = HISTORY_IO
        .lock()
        .map_err(|_| "browser history writer unavailable")?;
    remove_selected(&browser_folder(&app)?.join("history.json"), &urls)
}

#[tauri::command]
pub fn desktop_get_browser_access_rules(app: AppHandle) -> Result<Vec<AccessRecord>, String> {
    Ok(entries_access(&load_access(
        &browser_folder(&app)?.join("access.json"),
    )?))
}

#[tauri::command]
pub fn desktop_set_browser_access_rule(
    app: AppHandle,
    origin: String,
    decision: String,
) -> Result<Vec<AccessRecord>, String> {
    set_access(
        &browser_folder(&app)?.join("access.json"),
        &origin,
        &decision,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_store() -> PathBuf {
        let folder = std::env::temp_dir().join(format!("memmy-browser-{}", Uuid::new_v4()));
        safe_parent(&folder).unwrap();
        folder
    }
    fn entry(url: &str, visited_at: f64) -> HistoryEntry {
        HistoryEntry {
            id: None,
            url: url.into(),
            title: "Example".into(),
            visited_at,
            visit_source: None,
        }
    }
    #[test]
    fn native_page_visits_are_persisted_with_real_user_provenance() {
        let dir = temp_store();
        let path = dir.join("history.json");
        assert!(!record_native_visit(&path, "file:///etc/passwd", "bad", "other").unwrap());
        assert!(
            !record_native_visit(&path, "https://user:pass@example.org/", "bad", "other").unwrap()
        );
        assert!(!record_native_visit(&path, "https://example.org/", "not-agent", "agent").unwrap());
        assert!(
            record_native_visit(&path, "https://example.org/page", "Native page", "other").unwrap()
        );
        assert!(
            record_native_visit(&path, "https://example.org/page", "Updated page", "other")
                .unwrap()
        );
        let entries = load_history(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Updated page");
        assert_eq!(entries[0].visit_source.as_deref(), Some("other"));
        assert!(entries[0].visited_at > 1_000_000.0);
        assert!(remove_one(&path, "https://example.org/page").unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn history_migration_persists_sorted_and_deletes_by_id_or_url() {
        let dir = temp_store();
        let path = dir.join("history.json");
        assert!(import_legacy(
            &path,
            vec![
                entry("https://example.org/a", 100.0),
                entry("https://example.org/a", 120.0),
                entry("https://example.org/b", 110.0)
            ]
        )
        .unwrap());
        let loaded = load_history(&path).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].url, "https://example.org/a");
        assert_eq!(loaded[0].visited_at, 120.0);
        assert_eq!(loaded[0].visit_source.as_deref(), Some("other"));
        assert_eq!(
            remove_selected(&path, &[loaded[0].id.clone().unwrap()]).unwrap(),
            1
        );
        assert!(remove_one(&path, "https://example.org/b").unwrap());
        assert!(!remove_one(&path, "https://example.org/b").unwrap());
        assert!(load_history(&path).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_history_and_permission_records_cannot_grant_access() {
        let dir = temp_store();
        let history = dir.join("history.json");
        assert!(!import_legacy(&history, vec![entry("file:///etc/passwd", 1.0)]).unwrap());
        assert!(!import_legacy(
            &history,
            vec![entry("https://user:password@example.com", 1.0)]
        )
        .unwrap());
        assert!(!import_legacy(&history, vec![entry("https://example.com", f64::NAN)]).unwrap());
        assert!(!remove_selected(&history, &["file:///tmp/a".into()])
            .unwrap()
            .gt(&0));
        let access = dir.join("access.json");
        for origin in [
            "javascript:evil",
            "file:///secret",
            "https://example.com/a",
            "https://admin@example.com",
        ] {
            assert!(set_access(&access, origin, "allow").is_err());
        }
        assert!(set_access(&access, "https://example.com", "all").is_err());
        assert_eq!(
            set_access(&access, "https://example.com", "allow")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            load_access(&access).unwrap()["https://example.com"],
            "allow"
        );
        assert_eq!(
            set_access(&access, "https://example.com", "ask")
                .unwrap()
                .len(),
            0
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn download_directory_requires_native_selection_and_settings_persist() {
        let dir = temp_store();
        let path = dir.join("download-settings.json");
        assert!(download_settings(&path).unwrap().directory.is_none());
        assert!(select_download_directory(&path, Some(Path::new("./relative"))).is_err());
        let saved = select_download_directory(&path, Some(&dir)).unwrap();
        assert_eq!(saved.approved_directories.len(), 1);
        assert_eq!(
            saved.directory,
            Some(dir.canonicalize().unwrap().to_string_lossy().to_string())
        );
        let mut settings = download_settings(&path).unwrap();
        settings.ask_before_download = true;
        atomic_json(&path, &settings, 64 * 1024).unwrap();
        let reset = select_download_directory(&path, None).unwrap();
        assert_eq!(reset.directory, None);
        assert!(reset.ask_before_download);
        assert_eq!(reset.approved_directories.len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn forged_history_symlink_and_oversized_file_are_rejected() {
        let dir = temp_store();
        let history = dir.join("history.json");
        fs::write(&history, vec![b'!'; HISTORY_BYTES as usize + 1]).unwrap();
        assert!(load_history(&history).is_err());
        fs::remove_file(&history).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hosts", &history).unwrap();
            assert!(load_history(&history).is_err());
            assert!(import_legacy(&history, vec![entry("https://example.com", 1.0)]).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
