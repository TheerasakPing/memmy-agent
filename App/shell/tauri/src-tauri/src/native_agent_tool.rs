//! Real external Agent prompt handoff, ported from Electron's strict allowlist.
//! External pages can never invoke this command: only the trusted main WebView.
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};

const MAX_PROMPT_BYTES: usize = 8192;
const MAX_DEEPLINK_BYTES: usize = 24000;
const OSASCRIPT_DIRECT: &str = r#"on run argv
  set binaryPath to item 1 of argv
  set relayPrompt to item 2 of argv
  set launchCommand to "exec " & quoted form of binaryPath & " " & quoted form of relayPrompt
  tell application "Terminal"
    activate
    do script launchCommand
  end tell
end run"#;
const OSASCRIPT_OPENCLAW: &str = r#"on run argv
  set binaryPath to item 1 of argv
  set relayPrompt to item 2 of argv
  set launchCommand to "exec " & quoted form of binaryPath & " tui --message " & quoted form of relayPrompt
  tell application "Terminal"
    activate
    do script launchCommand
  end tell
end run"#;
const OSASCRIPT_OPENCODE: &str = r#"on run argv
  set binaryPath to item 1 of argv
  set relayPrompt to item 2 of argv
  set workingDirectory to item 3 of argv
  set launchCommand to "exec " & quoted form of binaryPath & " " & quoted form of workingDirectory & " --prompt " & quoted form of relayPrompt
  tell application "Terminal"
    activate
    do script launchCommand
  end tell
end run"#;
const OSASCRIPT_HERMES: &str = r#"on run argv
  set binaryPath to item 1 of argv
  set relayPrompt to item 2 of argv
  set quotedBinary to quoted form of binaryPath
  set launchCommand to quotedBinary & " chat -q " & quoted form of relayPrompt & "; exec " & quotedBinary & " --tui --continue"
  tell application "Terminal"
    activate
    do script launchCommand
  end tell
end run"#;

fn normalize_source(raw: &str) -> Option<&'static str> {
    let normalized = raw.trim().to_lowercase().replace([' ', '-'], "_");
    match normalized.as_str() {
        "cursor" => Some("cursor"),
        "claude_code" => Some("claude_code"),
        "codex" => Some("codex"),
        "workbuddy" => Some("workbuddy"),
        "opencode" => Some("opencode"),
        "openclaw" => Some("openclaw"),
        "hermes" => Some("hermes"),
        _ => None,
    }
}
fn normalize_prompt(raw: &str) -> Option<&str> {
    let p = raw.trim();
    if p.is_empty()
        || p.len() > MAX_PROMPT_BYTES
        || p.chars()
            .any(|c| c == '\0' || c == '\u{1b}' || (c.is_control() && c != '\n' && c != '\t'))
    {
        return None;
    }
    Some(p)
}
fn encoded(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}
fn gui_url(source: &str, prompt: &str, home: &Path) -> Option<String> {
    let p = encoded(prompt);
    let result = match source {
        "cursor" => format!("cursor://anysphere.cursor-deeplink/prompt?text={p}"),
        "claude_code" => format!("claude://claude.ai/new?q={p}"),
        "codex" => format!(
            "codex://threads/new?prompt={p}&path={}",
            encoded(home.to_str()?)
        ),
        "opencode" => format!(
            "opencode://new-session?directory={}&prompt={p}",
            encoded(home.to_str()?)
        ),
        "workbuddy" => {
            let with_command = if prompt == "/memmy-memory"
                || prompt.starts_with("/memmy-memory ")
                || prompt.starts_with("/memmy-memory\n")
            {
                prompt.to_string()
            } else {
                format!("/memmy-memory {prompt}")
            };
            format!(
                "workbuddy://task?action=start&prompt={}",
                encoded(&with_command)
            )
        }
        _ => return None,
    };
    if result.len() > MAX_DEEPLINK_BYTES {
        return None;
    }
    let url = url::Url::parse(&result).ok()?;
    if url.scheme() != source && !(source == "claude_code" && url.scheme() == "claude") {
        return None;
    }
    Some(result)
}
fn candidates(source: &str, home: &Path) -> Vec<PathBuf> {
    let rels: &[&str] = match source {
        "cursor" => &[".local/bin/cursor-agent", ".cursor/bin/cursor-agent"],
        "claude_code" => &[".local/bin/claude", ".claude/local/claude"],
        "codex" => &[".local/bin/codex", ".codex/bin/codex"],
        "opencode" => &[".opencode/bin/opencode", ".local/bin/opencode"],
        "openclaw" => &[".openclaw/bin/openclaw", ".local/bin/openclaw"],
        "hermes" => &[".hermes/bin/hermes", ".local/bin/hermes"],
        _ => &[],
    };
    let name = match source {
        "cursor" => "cursor-agent",
        "claude_code" => "claude",
        "codex" => "codex",
        "opencode" => "opencode",
        "openclaw" => "openclaw",
        "hermes" => "hermes",
        _ => return vec![],
    };
    let mut result: Vec<_> = rels.iter().map(|path| home.join(path)).collect();
    if source == "codex" {
        result.push(PathBuf::from(
            "/Applications/ChatGPT.app/Contents/Resources/codex",
        ));
    }
    result.push(PathBuf::from("/opt/homebrew/bin").join(name));
    result.push(PathBuf::from("/usr/local/bin").join(name));
    result
}
fn executable(path: &Path) -> bool {
    if !path.is_absolute()
        || path
            .to_str()
            .is_none_or(|s| s.chars().any(char::is_control))
    {
        return false;
    }
    let Ok(info) = std::fs::metadata(path) else {
        return false;
    };
    if !info.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        info.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}
fn run_timeout(command: &mut Command, duration: Duration) -> bool {
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    let limit = Instant::now() + duration;
    while Instant::now() < limit {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => std::thread::sleep(Duration::from_millis(35)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    false
}
fn open_mac_app(url: &str) -> bool {
    run_timeout(
        Command::new("/usr/bin/open").arg(url),
        Duration::from_secs(8),
    )
}
fn open_terminal(source: &str, prompt: &str, home: &Path) -> bool {
    let Some(binary) = candidates(source, home).into_iter().find(|p| executable(p)) else {
        return false;
    };
    let script = match source {
        "openclaw" => OSASCRIPT_OPENCLAW,
        "opencode" => OSASCRIPT_OPENCODE,
        "hermes" => OSASCRIPT_HERMES,
        "codex" | "cursor" | "claude_code" => OSASCRIPT_DIRECT,
        _ => return false,
    };
    let mut cmd = Command::new("/usr/bin/osascript");
    cmd.arg("-e").arg(script).arg(binary).arg(prompt);
    if source == "opencode" {
        cmd.arg(home);
    }
    run_timeout(&mut cmd, Duration::from_secs(9))
}
fn open_agent(source: &str, prompt: &str, home: &Path) -> bool {
    let Some(source) = normalize_source(source) else {
        return false;
    };
    let Some(prompt) = normalize_prompt(prompt) else {
        return false;
    };
    if let Some(url) = gui_url(source, prompt, home) {
        if open_mac_app(&url) {
            return true;
        }
    }
    if source == "claude_code" && open_mac_app(&format!("claude-cli://open?q={}", encoded(prompt)))
    {
        return true;
    }
    if source == "workbuddy" {
        let path = "/Applications/WorkBuddy.app";
        return Path::new(path).is_dir()
            && run_timeout(
                Command::new("/usr/bin/open").arg("-a").arg(path),
                Duration::from_secs(8),
            );
    }
    open_terminal(source, prompt, home)
}
#[tauri::command]
pub async fn desktop_open_agent_tool(
    app: AppHandle,
    window: WebviewWindow,
    source_id: String,
    prompt: String,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("external Agent launch requires first-party main window".into());
    }
    // The model text is never interpreted as a shell expression by Rust.
    if normalize_source(&source_id).is_none() || normalize_prompt(&prompt).is_none() {
        return Ok(json!({"opened":false}));
    }
    if !cfg!(target_os = "macos") {
        return Ok(json!({"opened":false}));
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Agent launch home unavailable")?;
    tauri::async_runtime::spawn_blocking(
        move || json!({"opened":open_agent(&source_id,&prompt,&home)}),
    )
    .await
    .map_err(|_| "Agent launch worker unavailable".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_agent_sources_and_bounded_prompts_can_be_relayed() {
        for source in [
            "cursor",
            "claude-code",
            "claude_code",
            "codex",
            "workbuddy",
            "opencode",
            "openclaw",
            "hermes",
        ] {
            assert!(normalize_source(source).is_some());
        }
        for value in [
            "terminal",
            "",
            "/bin/zsh",
            "cursor; touch /tmp/bad",
            "../../../etc",
        ] {
            assert!(normalize_source(value).is_none());
        }
        assert!(normalize_prompt("hi\nsecond line").is_some());
        for p in ["", "  ", "\0bad", "\u{1b}[31mbad"] {
            assert!(normalize_prompt(p).is_none());
        }
        assert!(normalize_prompt(&"x".repeat(8193)).is_none());
    }
    #[test]
    fn deep_links_never_inject_prompt_as_an_unescaped_uri_component() {
        let home = Path::new("/Users/a b/c");
        let dangerous = "hello & scheme=javascript: // ; ' \" $(touch /tmp/x)";
        for source in ["cursor", "claude_code", "codex", "workbuddy", "opencode"] {
            let link = gui_url(source, dangerous, home).unwrap();
            assert!(!link.contains(" $(touch "));
            assert!(!link.contains(" ; "));
            assert!(!link.contains("& scheme="));
            let parsed = url::Url::parse(&link).unwrap();
            let pairs: Vec<_> = parsed.query_pairs().collect();
            assert!(pairs
                .iter()
                .any(|(k, v)| (k == "prompt" || k == "q" || k == "text")
                    && (v == dangerous || v.starts_with("/memmy-memory "))));
        }
        let workbuddy = gui_url("workbuddy", "/memmy-memory hi", home).unwrap();
        assert!(!workbuddy.contains("%2Fmemmy-memory%20%2Fmemmy-memory"));
    }
    #[test]
    fn terminal_scripts_use_osascript_quoted_forms_not_prompt_interpolation() {
        for script in [
            OSASCRIPT_DIRECT,
            OSASCRIPT_OPENCLAW,
            OSASCRIPT_OPENCODE,
            OSASCRIPT_HERMES,
        ] {
            assert!(script.contains("quoted form of relayPrompt"));
            assert!(
                script.contains("quoted form of binaryPath") || script.contains("quotedBinary")
            );
            assert!(!script.contains("do shell script"));
        }
    }
    #[test]
    fn binary_resolution_never_uses_renderer_supplied_paths() {
        let home = Path::new("/Users/safe person");
        let paths = candidates("codex", home);
        assert!(paths.contains(&home.join(".local/bin/codex")));
        assert!(!paths.iter().any(|p| p.to_string_lossy().contains("../..")));
        assert!(candidates("bad", home).is_empty());
        assert!(!executable(Path::new("local-binary")));
    }
}
