//! Read-only Chrome/Edge extension metadata and process inventory.
//! Unknown/unreadable Chromium profiles are null, NEVER "not installed".
use serde_json::{json, Value};
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager, WebviewWindow};
const ID: &str = "mhodbgbbgalbhehapffidmdegokpoaom";
const MAX_PREFS: u64 = 8_000_000;
const MAX_PROFILES: usize = 48;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Presence {
    installed: Option<bool>,
    enabled: Option<bool>,
}
impl Presence {
    fn unknown() -> Self {
        Self {
            installed: None,
            enabled: None,
        }
    }
    fn absent() -> Self {
        Self {
            installed: Some(false),
            enabled: Some(false),
        }
    }
    fn present(enabled: bool) -> Self {
        Self {
            installed: Some(true),
            enabled: Some(enabled),
        }
    }
    fn to_value(self) -> Value {
        json!({"installed": self.installed, "enabled": self.enabled})
    }
}

fn read_bounded_json(path: &Path) -> Result<Option<Value>, ()> {
    let info = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if !info.is_file() || info.file_type().is_symlink() || info.len() > MAX_PREFS {
        return Err(());
    }
    let bytes = fs::read(path).map_err(|_| ())?;
    if bytes.len() > MAX_PREFS as usize {
        return Err(());
    }
    serde_json::from_slice::<Value>(&bytes)
        .map(Some)
        .map_err(|_| ())
}
fn profiles(root: &Path) -> Result<Vec<String>, ()> {
    let state = read_bounded_json(&root.join("Local State"))?;
    let mut names = Vec::new();
    if let Some(info) = state {
        let cache = info
            .pointer("/profile/info_cache")
            .and_then(Value::as_object)
            .ok_or(())?;
        for name in cache.keys() {
            if name == "Default"
                || name.strip_prefix("Profile ").is_some_and(|n| {
                    !n.is_empty() && n.len() < 6 && n.chars().all(|c| c.is_ascii_digit())
                })
            {
                names.push(name.clone());
            }
        }
        if names.len() > MAX_PROFILES {
            return Err(());
        }
    }
    if names.is_empty() && root.join("Default").exists() {
        names.push("Default".into());
    }
    Ok(names)
}
fn safe_regular_folder(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
}
fn manifest_valid(dir: &Path, unpacked: bool, original_key: &str) -> bool {
    let Some(manifest) = read_bounded_json(&dir.join("manifest.json")).ok().flatten() else {
        return false;
    };
    if !matches!(manifest["manifest_version"].as_u64(), Some(2 | 3))
        || manifest["name"]
            .as_str()
            .is_none_or(|n| n.trim().is_empty())
        || manifest["version"].as_str().is_none_or(|n| {
            n.is_empty() || n.len() > 30 || !n.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
    {
        return false;
    }
    match manifest["key"].as_str() {
        Some(key) => key == original_key,
        None => !unpacked,
    }
}
fn extension_record(root: &Path, profile: &Path, record: &Value, key: &str) -> bool {
    let Some(location) = record["location"].as_u64() else {
        return false;
    };
    if !(1..=10).contains(&location) {
        return false;
    }
    let Some(path) = record["path"].as_str() else {
        return false;
    };
    if path.is_empty() || path.len() > 4096 || path.chars().any(char::is_control) {
        return false;
    }
    let unpacked = matches!(location, 4 | 8);
    let candidate = Path::new(path);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        if unpacked {
            return false;
        }
        let normalized = path.replace('\\', "/");
        let Some((id, version)) = normalized.split_once('/') else {
            return false;
        };
        if id != ID
            || version.is_empty()
            || version.len() > 48
            || !version
                .chars()
                .all(|c| c.is_ascii_digit() || c == '.' || c == '_')
            || version.starts_with('.')
        {
            return false;
        }
        profile.join("Extensions").join(ID).join(version)
    };
    // A signed packed extension must be under the ID directory; unpacked
    // extensions use a browser-managed absolute path.
    if !unpacked
        && resolved
            .parent()
            .is_none_or(|p| p.file_name().is_none_or(|v| v != ID))
    {
        return false;
    }
    if !safe_regular_folder(&resolved) {
        return false;
    }
    let _ = root; // Path is used only for bounded metadata, never write to it.
    manifest_valid(&resolved, unpacked, key)
}
fn state_enabled(record: &Value) -> bool {
    if record.get("state").is_some_and(|v| v.as_u64() != Some(1)) {
        return false;
    }
    if record
        .get("disable_reasons")
        .is_some_and(|v| v != 0 && v.as_array().is_none_or(|a| !a.is_empty()))
    {
        return false;
    }
    true
}
fn scan_browser(root: &Path, original_key: &str) -> Presence {
    if !root.exists() {
        return Presence::absent();
    }
    if !safe_regular_folder(root) {
        return Presence::unknown();
    }
    let Ok(names) = profiles(root) else {
        return Presence::unknown();
    };
    if names.is_empty() {
        return Presence::unknown();
    }
    let mut partial = false;
    let mut installed = false;
    let mut enabled = false;
    for name in names {
        let profile = root.join(name);
        if !safe_regular_folder(&profile) {
            partial = true;
            continue;
        }
        let secure = read_bounded_json(&profile.join("Secure Preferences"));
        let ordinary = read_bounded_json(&profile.join("Preferences"));
        if secure.is_err() || ordinary.is_err() {
            partial = true;
            continue;
        }
        let secure = secure.unwrap();
        let ordinary = ordinary.unwrap();
        if secure.is_none() && ordinary.is_none() {
            partial = true;
            continue;
        }
        let record = secure
            .as_ref()
            .and_then(|v| v.pointer(&format!("/extensions/settings/{ID}")))
            .filter(|v| v.as_object().is_some_and(|o| !o.is_empty()))
            .or_else(|| {
                ordinary
                    .as_ref()
                    .and_then(|v| v.pointer(&format!("/extensions/settings/{ID}")))
            });
        let Some(record) = record else {
            continue;
        };
        if !extension_record(root, &profile, record, original_key) {
            partial = true;
            continue;
        }
        installed = true;
        enabled |= state_enabled(record);
    }
    if enabled {
        Presence::present(true)
    } else if partial {
        Presence {
            installed: installed.then_some(true),
            enabled: None,
        }
    } else if installed {
        Presence::present(false)
    } else {
        Presence::absent()
    }
}
fn browser_root(browser: &str, home: &Path) -> Option<PathBuf> {
    match (std::env::consts::OS, browser) {
        ("macos", "chrome") => Some(home.join("Library/Application Support/Google/Chrome")),
        ("macos", "edge") => Some(home.join("Library/Application Support/Microsoft Edge")),
        ("linux", "chrome") => Some(
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
                .join("google-chrome"),
        ),
        ("linux", "edge") => Some(
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
                .join("microsoft-edge"),
        ),
        ("windows", "chrome") => std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|p| p.join("Google/Chrome/User Data")),
        ("windows", "edge") => std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|p| p.join("Microsoft/Edge/User Data")),
        _ => None,
    }
}
fn extension_key() -> Option<String> {
    let manifest: Value = serde_json::from_str(include_str!(
        "../../../desktop/extensions/memmy-browser/manifest.json"
    ))
    .ok()?;
    manifest["key"].as_str().map(str::to_owned)
}
fn installation(home: &Path) -> Value {
    let key = extension_key().unwrap_or_default();
    let lookup = |browser: &str| {
        if key.is_empty() {
            return Presence::unknown().to_value();
        }
        browser_root(browser, home)
            .map(|root| scan_browser(&root, &key))
            .unwrap_or_else(Presence::unknown)
            .to_value()
    };
    json!({"chrome":lookup("chrome"),"edge":lookup("edge")})
}
fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        Err("browser inventory requires first-party main webview".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn desktop_get_browser_extension_installation(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Value, String> {
    require_main(&window)?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "user home not available")?;
    tauri::async_runtime::spawn_blocking(move || installation(&home))
        .await
        .map_err(|_| "browser installation probe unavailable".into())
}
#[tauri::command]
pub async fn desktop_list_installed_browser_extensions(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<String>, String> {
    require_main(&window)?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "user home not available")?;
    let state = tauri::async_runtime::spawn_blocking(move || installation(&home))
        .await
        .map_err(|_| "browser installation probe unavailable")?;
    Ok(["chrome", "edge"]
        .iter()
        .filter(|name| state[*name]["enabled"] == true)
        .map(|name| (*name).to_string())
        .collect())
}
/// Exact application process executable matches only; never substrings in arguments.
fn mac_running_from_ps(output: &str) -> Option<Vec<String>> {
    let mut found = Vec::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let (pid, comm) = line.trim().split_once(char::is_whitespace)?;
        if pid.parse::<u32>().ok()? == 0 {
            return None;
        }
        let exe = comm.trim();
        let browser = match exe {
            "Google Chrome" => Some("chrome"),
            "Microsoft Edge" => Some("edge"),
            _ if exe.starts_with('/')
                && exe.ends_with("/Google Chrome.app/Contents/MacOS/Google Chrome") =>
            {
                Some("chrome")
            }
            _ if exe.starts_with('/')
                && exe.ends_with("/Microsoft Edge.app/Contents/MacOS/Microsoft Edge") =>
            {
                Some("edge")
            }
            _ => None,
        };
        if let Some(browser) = browser {
            if !found.contains(&browser) {
                found.push(browser);
            }
        }
    }
    found.sort_unstable();
    Some(found.into_iter().map(str::to_owned).collect())
}
fn windows_running_from_json(output: &str) -> Option<Vec<String>> {
    let data: Value = serde_json::from_str(output.trim().trim_start_matches('\u{feff}')).ok()?;
    let array = data.as_array()?;
    let mut found = Vec::new();
    for row in array {
        let name = row.get("Name")?.as_str()?.to_ascii_lowercase();
        let browser = match name.as_str() {
            "chrome.exe" => "chrome",
            "msedge.exe" => "edge",
            _ => continue,
        };
        if row.get("ExecutablePath").is_some_and(|value| {
            !value.is_null()
                && value.as_str().is_none_or(|p| {
                    p.rsplit(['/', '\\'])
                        .next()
                        .is_none_or(|v| !v.eq_ignore_ascii_case(&name))
                })
        }) {
            continue;
        }
        if row.get("CommandLine").is_some_and(|value| {
            !value.is_null()
                && value.as_str().is_some_and(|s| {
                    s.split_ascii_whitespace()
                        .any(|v| v == "--type" || v.starts_with("--type="))
                })
        }) {
            continue;
        }
        if !found.contains(&browser) {
            found.push(browser);
        }
    }
    found.sort_unstable();
    Some(found.into_iter().map(str::to_owned).collect())
}
fn safe_output(output: std::process::Output) -> Option<String> {
    if !output.status.success() || output.stdout.len() > 1_048_576 {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}
fn running_browsers() -> Option<Vec<String>> {
    match std::env::consts::OS {
        "macos" => {
            let user = safe_output(Command::new("/usr/bin/id").arg("-u").output().ok()?)?;
            let uid = user.trim();
            if uid.is_empty() || uid.len() > 10 || !uid.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let output = Command::new("/bin/ps")
                .args(["-U", uid, "-o", "pid=,comm=", "-ww"])
                .output()
                .ok()?;
            mac_running_from_ps(&safe_output(output)?)
        }
        "windows" => {
            // Fixed OS executable and literal CIM query; no renderer-supplied strings.
            const QUERY: &str = r#"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId; $filter="(Name = 'chrome.exe' OR Name = 'msedge.exe') AND SessionId = " + $session; $items=@(Get-CimInstance Win32_Process -Filter $filter | Select-Object Name, ExecutablePath, CommandLine); ConvertTo-Json -InputObject $items -Compress"#;
            let exe = Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
            let output = Command::new(exe)
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    QUERY,
                ])
                .output()
                .ok()?;
            windows_running_from_json(&safe_output(output)?)
        }
        // The legacy Electron implementation also treats Linux as unknown.
        _ => None,
    }
}
#[tauri::command]
pub async fn desktop_list_running_external_browsers(
    window: WebviewWindow,
) -> Result<Option<Vec<String>>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(running_browsers)
        .await
        .map_err(|_| "external browser process inventory unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, String) {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("memmy-browser-probe-{}", uuid::Uuid::new_v4()));
        let profile = root.join("Default");
        fs::create_dir_all(profile.join("Extensions").join(ID).join("1.0.0")).unwrap();
        let key = extension_key().unwrap();
        fs::write(
            root.join("Local State"),
            r#"{"profile":{"info_cache":{"Default":{}}}}"#,
        )
        .unwrap();
        fs::write(
            profile
                .join("Extensions")
                .join(ID)
                .join("1.0.0")
                .join("manifest.json"),
            r#"{"manifest_version":3,"name":"Memmy","version":"1.0.0"}"#,
        )
        .unwrap();
        fs::write(profile.join("Preferences"), json!({"extensions":{"settings":{
            "mhodbgbbgalbhehapffidmdegokpoaom":{"location":1,"path":format!("{ID}/1.0.0"),"state":1}
        }}}).to_string()).unwrap();
        (root, key)
    }
    #[test]
    fn only_valid_bounded_profile_metadata_proves_installed() {
        let (root, key) = fixture();
        assert_eq!(scan_browser(&root, &key), Presence::present(true));
        fs::write(root.join("Default/Preferences"),json!({"extensions":{"settings":{
            "mhodbgbbgalbhehapffidmdegokpoaom":{"location":1,"path":format!("{ID}/1.0.0"),"state":0}
        }}}).to_string()).unwrap();
        assert_eq!(scan_browser(&root, &key), Presence::present(false));
        fs::write(root.join("Default/Preferences"), "corrupt JSON").unwrap();
        assert_eq!(scan_browser(&root, &key), Presence::unknown());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_forged_extension_paths_missing_or_symlinked_manifest() {
        let (root, key) = fixture();
        let profile = root.join("Default");
        fs::write(profile.join("Preferences"),json!({"extensions":{"settings":{
            "mhodbgbbgalbhehapffidmdegokpoaom":{"location":1,"path":"../../../../private/evil","state":1}
        }}}).to_string()).unwrap();
        assert_eq!(scan_browser(&root, &key), Presence::unknown());
        fs::write(profile.join("Preferences"),json!({"extensions":{"settings":{
            "mhodbgbbgalbhehapffidmdegokpoaom":{"location":1,"path":format!("{ID}/1.0.0"),"state":1}
        }}}).to_string()).unwrap();
        #[cfg(unix)]
        {
            let manifest = profile
                .join("Extensions")
                .join(ID)
                .join("1.0.0/manifest.json");
            fs::remove_file(&manifest).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", manifest).unwrap();
            assert_eq!(scan_browser(&root, &key), Presence::unknown());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_exact_mac_browser_executable_names_are_recognized() {
        let parsed = mac_running_from_ps(
            " 103 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n\
             205 Microsoft Edge\n 600 /usr/bin/google-chrome-wrapper\n",
        )
        .unwrap();
        assert_eq!(parsed, vec!["chrome".to_string(), "edge".to_string()]);
        assert!(mac_running_from_ps("malformed data\n").is_none());
    }
    #[test]
    fn windows_process_inventory_excludes_renderer_and_forged_binary_paths() {
        let found = windows_running_from_json(r#"[
          {"Name":"chrome.exe","ExecutablePath":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","CommandLine":"chrome.exe"},
          {"Name":"msedge.exe","ExecutablePath":"C:\\Program Files\\Edge\\msedge.exe","CommandLine":"msedge.exe --type=renderer"},
          {"Name":"chrome.exe","ExecutablePath":"C:\\Users\\Bob\\fake.exe","CommandLine":"chrome.exe"},
          {"Name":"msedge.exe","ExecutablePath":null,"CommandLine":null}
        ]"#).unwrap();
        assert_eq!(found, vec!["chrome".to_string(), "edge".to_string()]);
        assert!(windows_running_from_json("malformed").is_none());
    }

    #[test]
    fn refuses_oversized_preferences_and_wrong_extension_public_key() {
        let (root, key) = fixture();
        let prefs = root.join("Default/Preferences");
        let oversized = fs::OpenOptions::new().write(true).open(&prefs).unwrap();
        oversized.set_len(MAX_PREFS + 1).unwrap();
        assert_eq!(scan_browser(&root, &key), Presence::unknown());
        fs::write(
            &prefs,
            json!({"extensions":{"settings":{
                "mhodbgbbgalbhehapffidmdegokpoaom":{
                    "location":1,"path":format!("{ID}/1.0.0"),"state":1
                }
            }}})
            .to_string(),
        )
        .unwrap();
        let manifest = root
            .join("Default/Extensions")
            .join(ID)
            .join("1.0.0/manifest.json");
        fs::write(
            &manifest,
            r#"{"manifest_version":3,"name":"Fake","version":"1.0","key":"not-original"}"#,
        )
        .unwrap();
        assert_eq!(scan_browser(&root, &key), Presence::unknown());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unrecognized_profile_is_unknown_not_false_installation() {
        let (root, key) = fixture();
        fs::remove_file(root.join("Default/Preferences")).unwrap();
        assert_eq!(scan_browser(&root, &key), Presence::unknown());
        fs::remove_dir_all(root).unwrap();
    }
}
