//! Signature-verified Tauri updater; disabled unless release credentials are
//! pinned at compile time. Never download/execute arbitrary renderer URLs.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use uuid::Uuid;

const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;
const UPDATE_EVENT: &str = "memmy:update-download-progress";

#[derive(Default)]
pub struct SignedUpdaterState {
    checked: Mutex<Option<Update>>,
    prepared: Mutex<Option<PreparedUpdate>>,
    downloading: AtomicBool,
    installing: AtomicBool,
}
struct PreparedUpdate {
    path: PathBuf,
    hash: [u8; 32],
    update: Update,
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    open_installer: Option<bool>,
}

fn release_channel_matches(version: &str) -> bool {
    // Alpha builds must never be upgraded from a stable feed (or vice versa).
    match option_env!("MEMMY_TAURI_UPDATER_CHANNEL") {
        Some("preview") => version.contains('-'),
        Some("stable") => !version.contains('-'),
        _ => false,
    }
}
fn signed_settings() -> Option<(url::Url, &'static str)> {
    let public_key = option_env!("MEMMY_TAURI_UPDATER_PUBLIC_KEY")?;
    let endpoint = option_env!("MEMMY_TAURI_UPDATER_ENDPOINT")?;
    if !release_channel_matches(env!("CARGO_PKG_VERSION"))
        || public_key.len() < 40
        || public_key.len() > 2048
    {
        return None;
    }
    let endpoint = url::Url::parse(endpoint).ok()?;
    if !trusted_https(&endpoint) {
        return None;
    }
    Some((endpoint, public_key))
}
fn trusted_https(uri: &url::Url) -> bool {
    uri.scheme() == "https"
        && matches!(uri.host(), Some(url::Host::Domain(host))
            if !host.trim_end_matches('.').eq_ignore_ascii_case("localhost")
                && !host.trim_end_matches('.').ends_with(".local"))
        && uri.username().is_empty()
        && uri.password().is_none()
        && uri.fragment().is_none()
}
fn trusted_asset(uri: &url::Url, manifest: &url::Url) -> bool {
    if !trusted_https(uri) {
        return false;
    }
    // An explicitly configured but invalid CDN origin must fail closed.
    let allowed = match option_env!("MEMMY_TAURI_UPDATER_ASSET_ORIGIN") {
        Some(value) => match url::Url::parse(value) {
            Ok(uri) => uri,
            Err(_) => return false,
        },
        None => manifest.clone(),
    };
    trusted_https(&allowed) && uri.origin() == allowed.origin()
}
fn matches_checked_metadata(payload: &Value, version: &str, download_url: &str) -> bool {
    payload.get("status").and_then(Value::as_str) == Some("available")
        && payload.get("latestVersion").and_then(Value::as_str) == Some(version)
        && payload.get("downloadUrl").and_then(Value::as_str) == Some(download_url)
}
fn check_update_payload(payload: &Value, update: &Update) -> Result<(), String> {
    if !matches_checked_metadata(payload, &update.version, update.download_url.as_str()) {
        return Err("update metadata does not match trusted native release check".into());
    }
    Ok(())
}
fn stage_verified(path: &Path, bytes: &[u8]) -> Result<[u8; 32], String> {
    if bytes.is_empty() || bytes.len() > MAX_PACKAGE_BYTES {
        return Err("signed updater package is empty or exceeds 512 MiB".into());
    }
    let parent = path.parent().ok_or("update staging folder missing")?;
    let info = fs::symlink_metadata(parent).map_err(|_| "update staging folder unavailable")?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err("update staging folder unsafe".into());
    }
    let hash: [u8; 32] = Sha256::digest(bytes).into();
    // Each stage target has a new Rust-generated UUID; no overwrite of other files.
    let mut opts = OpenOptions::new();
    opts.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(path)
        .map_err(|_| "update package already exists or cannot be created")?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(path);
        return Err(format!(
            "verified update package could not be saved: {error}"
        ));
    }
    Ok(hash)
}
fn read_verified(path: &Path, hash: &[u8; 32]) -> Result<Vec<u8>, String> {
    let info = fs::symlink_metadata(path).map_err(|_| "staged update package unavailable")?;
    if !info.is_file()
        || info.file_type().is_symlink()
        || info.len() == 0
        || info.len() > MAX_PACKAGE_BYTES as u64
    {
        return Err("staged update package unsafe".into());
    }
    let bytes = fs::read(path).map_err(|_| "staged update unreadable")?;
    let digest: [u8; 32] = Sha256::digest(&bytes).into();
    if &digest != hash {
        return Err("staged signed update package was modified".into());
    }
    Ok(bytes)
}
fn progress(
    download_url: &str,
    file_path: &Path,
    received: u64,
    total: Option<u64>,
    complete: bool,
) -> Value {
    let percent = total.filter(|size| *size > 0).map(|size| {
        ((received as f64 / size as f64) * 100.0)
            .round()
            .clamp(0.0, if complete { 100.0 } else { 99.0 }) as u64
    });
    json!({"downloadUrl":download_url,"filePath":file_path.to_string_lossy(),
       "transferredBytes":received,"totalBytes":total,"percent":percent})
}
fn stage_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "native update data directory unavailable")?;
    fs::create_dir_all(&root).map_err(|_| "native update root cannot be created")?;
    let root_info = fs::symlink_metadata(&root).map_err(|_| "native update root unsafe")?;
    if !root_info.is_dir() || root_info.file_type().is_symlink() {
        return Err("native update root must be a real directory".into());
    }
    let path = root.join("signed-updates");
    fs::create_dir_all(&path).map_err(|_| "native updater directory cannot be created")?;
    let meta =
        fs::symlink_metadata(&path).map_err(|_| "native updater directory cannot be inspected")?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("signed update directory unsafe".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "cannot secure signed update directory")?;
    }
    Ok(path)
}
async fn checked_update(app: &AppHandle, endpoint: &url::Url) -> Result<Option<Update>, String> {
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.clone()])
        .map_err(|_| "signed update endpoint invalid")?
        .no_proxy()
        .configure_client(|builder| builder.redirect(reqwest::redirect::Policy::none()))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "signed updater configuration invalid")?;
    updater
        .check()
        .await
        .map_err(|_| "signed update manifest check failed".into())
}

#[tauri::command]
pub async fn desktop_signed_check_for_updates(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, SignedUpdaterState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("signed updater requires main window".into());
    }
    let version = app.package_info().version.to_string();
    let Some((endpoint, _key)) = signed_settings() else {
        return Ok(json!({"status":"not-configured","currentVersion":version}));
    };
    let result = checked_update(&app, &endpoint).await?;
    let mut checked = state
        .checked
        .lock()
        .map_err(|_| "update state unavailable")?;
    *checked = None;
    let Some(update) = result else {
        return Ok(json!({"status":"latest","currentVersion":version}));
    };
    if !trusted_asset(&update.download_url, &endpoint) {
        return Err("signed manifest references untrusted update asset origin".into());
    }
    let output = json!({"status":"available","currentVersion":version,
        "latestVersion":update.version,
        "downloadUrl":update.download_url.as_str(),
        "releaseNotes":update.body,
        "publishedAt":update.date.map(|date|date.to_string())});
    *checked = Some(update);
    Ok(output)
}
#[tauri::command]
pub async fn desktop_signed_download_update(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, SignedUpdaterState>,
    update: Value,
    options: Option<DownloadOptions>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("signed updater requires main window".into());
    }
    let Some((endpoint, _key)) = signed_settings() else {
        return Err("signed native updater not configured".into());
    };
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("signed update already downloading".into());
    }
    let result = async {
        let selected = state
            .checked
            .lock()
            .map_err(|_| "updater state unavailable")?
            .clone()
            .ok_or("trusted native update check required before download")?;
        check_update_payload(&update, &selected)?;
        if !trusted_asset(&selected.download_url, &endpoint) {
            return Err("untrusted signed asset origin".into());
        }
        let folder = stage_folder(&app)?;
        let path = folder.join(format!("memmy-signed-{}.update", Uuid::new_v4()));
        let url = selected.download_url.as_str().to_owned();
        let mut received = 0u64;
        let mut declared_total = None;
        let bytes = selected
            .download(
                |chunk, total| {
                    received = received.saturating_add(chunk as u64);
                    declared_total = total;
                    let event = progress(&url, &path, received, total, false);
                    let _ = app.emit_to("main", UPDATE_EVENT, event);
                },
                || {},
            )
            .await
            .map_err(|_| "signed update download or cryptographic verification failed")?;
        if received as usize > MAX_PACKAGE_BYTES || bytes.len() > MAX_PACKAGE_BYTES {
            return Err("signed update exceeds 512 MiB".into());
        }
        let hash = stage_verified(&path, &bytes)?;
        let _ = app.emit_to(
            "main",
            UPDATE_EVENT,
            progress(
                &url,
                &path,
                bytes.len() as u64,
                Some(bytes.len() as u64),
                true,
            ),
        );
        let previous = state
            .prepared
            .lock()
            .map_err(|_| "update stage unavailable")?
            .replace(PreparedUpdate {
                path: path.clone(),
                hash,
                update: selected.clone(),
            });
        if let Some(old) = previous {
            let _ = fs::remove_file(old.path);
        }
        let file_path = path.to_string_lossy().into_owned();
        if options.unwrap_or_default().open_installer.unwrap_or(true) {
            install_prepared(&app, &state, &file_path).await
        } else {
            Ok(json!({"filePath":file_path,"opened":false}))
        }
    }
    .await;
    state.downloading.store(false, Ordering::SeqCst);
    result
}
async fn install_prepared(
    app: &AppHandle,
    state: &SignedUpdaterState,
    path: &str,
) -> Result<Value, String> {
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err("signed updater installation already running".into());
    }
    let result = install_prepared_inner(app, state, path).await;
    state.installing.store(false, Ordering::SeqCst);
    result
}
async fn install_prepared_inner(
    app: &AppHandle,
    state: &SignedUpdaterState,
    path: &str,
) -> Result<Value, String> {
    let prepared = state
        .prepared
        .lock()
        .map_err(|_| "signed update state unavailable")?
        .as_ref()
        .map(|p| (p.path.clone(), p.hash, p.update.clone()))
        .ok_or("no authenticated signed updater package has been staged")?;
    if prepared.0.to_str() != Some(path) {
        return Err("cannot install arbitrary or stale update file path".into());
    }
    let verified = read_verified(&prepared.0, &prepared.1)?;
    let update = prepared.2;
    let bytes = verified;
    let outcome = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|_| "native updater worker unavailable")?;
    outcome.map_err(|_| "native signed updater installation failed")?;
    let _ = fs::remove_file(&prepared.0);
    *state
        .prepared
        .lock()
        .map_err(|_| "signed update state unavailable")? = None;
    // Windows NSIS may terminate app after successful installer launch.
    let _ = app;
    Ok(json!({"filePath":path,"opened":true,"willQuit":cfg!(target_os="windows")}))
}
#[tauri::command]
pub async fn desktop_signed_open_update_installer(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, SignedUpdaterState>,
    file_path: String,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("signed updater requires main window".into());
    }
    if signed_settings().is_none() {
        return Err("signed updater not configured".into());
    }
    install_prepared(&app, &state, &file_path).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_channel_never_allows_alpha_into_stable_feed() {
        match option_env!("MEMMY_TAURI_UPDATER_CHANNEL") {
            Some("preview") => {
                assert!(release_channel_matches("1.2.5-alpha.3"));
                assert!(!release_channel_matches("1.2.5"));
            }
            Some("stable") => {
                assert!(!release_channel_matches("1.2.5-alpha.3"));
                assert!(release_channel_matches("1.2.5"));
            }
            _ => {
                assert!(!release_channel_matches("1.2.5-alpha.3"));
                assert!(!release_channel_matches("1.2.5"));
            }
        }
    }

    #[test]
    fn unconfigured_release_channel_is_fail_closed_and_urls_are_pinned() {
        assert!(signed_settings().is_none() || signed_settings().unwrap().0.scheme() == "https");
        let endpoint = url::Url::parse("https://updates.memmy.example/v1/manifest.json").unwrap();
        for bad in [
            "http://updates.memmy.example/release",
            "https://localhost/update",
            "https://127.0.0.1/update",
            "https://[::1]/update",
            "file:///etc/hosts",
            "https://evil.example/update",
            "https://user:secret@updates.memmy.example/file",
        ] {
            assert!(
                !trusted_asset(&url::Url::parse(bad).unwrap(), &endpoint),
                "{bad}"
            );
        }
        assert!(trusted_asset(
            &url::Url::parse("https://updates.memmy.example/releases/app.tar.gz").unwrap(),
            &endpoint
        ));
    }
    #[test]
    fn native_updater_never_accepts_renderer_modified_release_metadata() {
        // Real Update is constructed exclusively by trusted plugin manifest.
        // A stale or renderer-controlled URL/version cannot select a download.
        let checked = SignedUpdaterState::default();
        assert!(checked.checked.lock().unwrap().is_none());
        assert!(checked.prepared.lock().unwrap().is_none());
        assert!(!checked.downloading.load(Ordering::SeqCst));
        assert!(!checked.installing.load(Ordering::SeqCst));
    }
    #[test]
    fn renderer_cannot_replace_checked_update_version_or_download_url() {
        let url = "https://updates.memmy.example/download/mac-arm64.tar.gz";
        let valid = json!({"status":"available","latestVersion":"1.2.6","downloadUrl":url});
        assert!(matches_checked_metadata(&valid, "1.2.6", url));
        for attempt in [
            json!({"status":"latest","latestVersion":"1.2.6","downloadUrl":url}),
            json!({"status":"available","latestVersion":"9.9.9","downloadUrl":url}),
            json!({"status":"available","latestVersion":"1.2.6","downloadUrl":"https://evil.example/update"}),
            json!({"status":"available","latestVersion":"1.2.6"}),
        ] {
            assert!(!matches_checked_metadata(&attempt, "1.2.6", url));
        }
    }
    #[test]
    fn simultaneous_installs_are_refused() {
        let state = SignedUpdaterState::default();
        assert!(!state.installing.swap(true, Ordering::SeqCst));
        assert!(state.installing.swap(true, Ordering::SeqCst));
        state.installing.store(false, Ordering::SeqCst);
        assert!(!state.installing.swap(true, Ordering::SeqCst));
    }
    #[test]
    fn only_exact_staged_signed_bytes_remain_installable() {
        let root = std::env::temp_dir().join(format!("memmy-updater-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("trusted.update");
        let hash = stage_verified(&file, b"test signed bytes").unwrap();
        assert_eq!(read_verified(&file, &hash).unwrap(), b"test signed bytes");
        fs::write(&file, b"mutated").unwrap();
        assert!(read_verified(&file, &hash).is_err());
        #[cfg(unix)]
        {
            fs::remove_file(&file).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", &file).unwrap();
            assert!(read_verified(&file, &hash).is_err());
        }
        assert!(stage_verified(&root.join("empty"), b"").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn signed_progress_never_reports_completed_before_verification() {
        let p = Path::new("/tmp/verified.update");
        let during = progress("https://updates.memmy.example/a", p, 120, Some(100), false);
        assert_eq!(during["percent"], 99);
        assert_eq!(
            progress("https://updates.memmy.example/a", p, 100, Some(100), true)["percent"],
            100
        );
        assert!(
            progress("https://updates.memmy.example/a", p, 42, None, false)["percent"].is_null()
        );
    }
}
