//! Rust-managed local API child for Tauri. No arbitrary command from the webview.
//! Development starts a known repository entry; packaged builds fail closed
//! until signed cross-platform sidecars and the Memory/Agent stack are ready.
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use crate::is_loopback_runtime_config;

const READY_PREFIX: &str = "MEMMY_TAURI_READY ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct BackendState {
    process: Option<Child>,
    config: Option<Value>,
    stopped_unexpectedly: bool,
}

#[derive(Default)]
pub struct NativeRuntime {
    state: Mutex<BackendState>,
}

impl NativeRuntime {
    pub fn config(&self, data_dir: &Path) -> Result<Value, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "native runtime lock unavailable")?;
        if let Some(child) = state.process.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    return state
                        .config
                        .clone()
                        .ok_or_else(|| "runtime config absent".into())
                }
                Ok(Some(_)) | Err(_) => {
                    state.process.take();
                    state.config = None;
                    state.stopped_unexpectedly = true;
                    return Err("Tauri Local API stopped unexpectedly; restart the app".into());
                }
            }
        }
        if state.stopped_unexpectedly {
            return Err("Tauri Local API requires an app restart".into());
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = data_dir;
            return Err("Tauri signed backend sidecar not yet bundled; release is blocked".into());
        }
        #[cfg(debug_assertions)]
        {
            if std::env::var("MEMMY_TAURI_DEV_BACKEND").as_deref() != Ok("1") {
                return Err(
                    "Tauri Local API development backend disabled; set MEMMY_TAURI_DEV_BACKEND=1"
                        .into(),
                );
            }
            let (child, config) = launch_development_backend(data_dir)?;
            state.process = Some(child);
            state.config = Some(config.clone());
            Ok(config)
        }
    }

    pub fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(mut process) = state.process.take() {
                // Closing stdin asks the owned Node child to close its API and
                // SQLite handles. Terminate only if the grace period expires.
                process.stdin.take();
                let deadline = Instant::now() + Duration::from_secs(2);
                loop {
                    match process.try_wait() {
                        Ok(Some(_)) => break,
                        _ if Instant::now() >= deadline => {
                            let _ = process.kill();
                            let _ = process.wait();
                            break;
                        }
                        _ => std::thread::sleep(Duration::from_millis(25)),
                    }
                }
            }
            state.config = None;
            state.stopped_unexpectedly = true;
        }
    }
}

impl Drop for NativeRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

fn parse_ready_line(line: &str) -> Result<Value, String> {
    let raw = line
        .strip_prefix(READY_PREFIX)
        .ok_or("invalid sidecar readiness marker")?;
    let value: Value = serde_json::from_str(raw).map_err(|_| "invalid sidecar handshake JSON")?;
    if !is_loopback_runtime_config(&value)
        || value["localToken"].as_str().is_none_or(|v| v.len() < 32)
    {
        return Err("sidecar handshake rejected: loopback/token requirements not met".into());
    }
    Ok(value)
}

#[cfg(debug_assertions)]
fn launch_development_backend(data_dir: &Path) -> Result<(Child, Value), String> {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/backend.mjs");
    if !script.is_file() {
        return Err("Tauri development sidecar script missing".into());
    }
    std::fs::create_dir_all(data_dir).map_err(|_| "cannot create native runtime directory")?;
    if std::fs::symlink_metadata(data_dir)
        .map_err(|_| "cannot check runtime directory")?
        .file_type()
        .is_symlink()
    {
        return Err("runtime directory symlink is not permitted".into());
    }
    let mut child = Command::new("node")
        .arg(script)
        .env("MEMMY_TAURI_DATA_DIR", data_dir)
        .env("MEMMY_TAURI_DEV_BACKEND", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            "Node development runtime missing from PATH; do not use this mode for release"
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or("sidecar readiness pipe missing")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut ready_sent = false;
        for _ in 0..100_000 {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() > 16 * 1024 => break,
                Ok(_) if line.starts_with(READY_PREFIX) && !ready_sent => {
                    ready_sent = true;
                    let _ = sender.send(parse_ready_line(line.trim_end()));
                    // Continue draining stdout. Closing the pipe after READY
                    // can crash an otherwise healthy Node child with EPIPE.
                }
                Ok(_) => {}
            }
        }
        if !ready_sent {
            let _ = sender.send(Err("sidecar exited or never became ready".into()));
        }
    });
    match receiver.recv_timeout(STARTUP_TIMEOUT) {
        Ok(Ok(config)) => Ok((child, config)),
        Ok(Err(message)) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(message)
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err("sidecar startup timed out".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_ready_line, NativeRuntime};
    use serde_json::json;
    #[test]
    fn rejects_untrusted_and_short_token_sidecar_handshakes() {
        for line in [
            "not-ready {}",
            "MEMMY_TAURI_READY {oops}",
            "MEMMY_TAURI_READY {\"baseUrl\":\"http://10.1.1.2:3000\",\"localToken\":\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"}",
            "MEMMY_TAURI_READY {\"baseUrl\":\"http://127.0.0.1:3000\",\"localToken\":\"short\"}"
        ] { assert!(parse_ready_line(line).is_err()); }
        let accepted = json!({"baseUrl":"http://127.0.0.1:3000", "localToken":"0123456789abcdef0123456789abcdef"});
        assert_eq!(
            parse_ready_line(&format!("MEMMY_TAURI_READY {accepted}")).unwrap(),
            accepted
        );
    }

    #[test]
    fn stopped_supervisor_cannot_restart_or_reuse_stale_credentials() {
        let supervisor = NativeRuntime::default();
        supervisor.stop();
        assert!(supervisor
            .config(std::path::Path::new("/tmp/does-not-exist"))
            .is_err());
    }
}
