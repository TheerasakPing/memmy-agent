//! Rust-managed local API child for Tauri. No arbitrary command from the webview.
//! Development starts a known repository entry; packaged builds fail closed
//! until signed cross-platform sidecars and the Memory/Agent stack are ready.
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
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
    memory: Option<Child>,
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
        if let Some(memory) = state.memory.as_mut() {
            if !matches!(memory.try_wait(), Ok(None)) {
                if let Some(mut backend) = state.process.take() {
                    stop_child(&mut backend);
                }
                state.memory.take();
                state.config = None;
                state.stopped_unexpectedly = true;
                return Err("Tauri Memory service stopped unexpectedly; restart the app".into());
            }
        }
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
                    if let Some(mut memory) = state.memory.take() {
                        stop_child(&mut memory);
                    }
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
            let mut memory = if std::env::var("MEMMY_TAURI_DEV_MEMORY").as_deref() == Ok("1") {
                Some(launch_development_memory(data_dir)?)
            } else {
                None
            };
            let backend_result = launch_development_backend(
                data_dir,
                memory
                    .as_ref()
                    .map(|(_, url, token)| (url.as_str(), token.as_str())),
            );
            match backend_result {
                Ok((child, config)) => {
                    state.process = Some(child);
                    state.memory = memory.take().map(|(process, _, _)| process);
                    state.config = Some(config.clone());
                    return Ok(config);
                }
                Err(err) => {
                    if let Some((mut process, _, _)) = memory.take() {
                        stop_child(&mut process);
                    }
                    return Err(err);
                }
            }
        }
    }

    pub fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(mut process) = state.process.take() {
                stop_child(&mut process);
            }
            if let Some(mut memory) = state.memory.take() {
                stop_child(&mut memory);
            }
            state.config = None;
            state.stopped_unexpectedly = true;
        }
    }
}

fn stop_child(process: &mut Child) {
    // Request the Node process's own graceful cleanup; enforce a deadline.
    process.stdin.take();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match process.try_wait() {
            Ok(Some(_)) => break,
            _ if Instant::now() >= deadline => {
                let _ = process.kill();
                let _ = process.wait();
                break;
            }
            _ => std::thread::sleep(Duration::from_millis(40)),
        }
    }
}

#[cfg(debug_assertions)]
fn ensure_managed_data_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "cannot prepare native data directory")?;
    let metadata = fs::symlink_metadata(path).map_err(|_| "native data directory unreadable")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("native data directory is not a directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "cannot protect native data directory")?;
    }
    let config = path.join("config.yaml");
    // Never overwrite user preferences/config. First boot disables auto-import
    // and skill auto-injection; this is deliberately opt-in for migration.
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&config) {
        Ok(mut file) => {
            let initial = serde_json::json!({
                "memmyMemory": {
                    "agentAccess": {
                        "autoScanKnownAgents": false,
                        "watchFileChanges": false,
                        "autoInjectSkill": false
                    }
                }
            });
            file.write_all(initial.to_string().as_bytes())
                .map_err(|_| "cannot initialize private Memory config")?;
            file.sync_all().map_err(|_| "cannot sync Memory config")?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(&config).map_err(|_| "config not readable")?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("existing Memory config is unsafe".into());
            }
        }
        Err(_) => return Err("cannot create private Memory config".into()),
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn memory_is_ready(port: u16, token: &str) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(350)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request = format!("GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut output = String::new();
    if stream.take(128 * 1024).read_to_string(&mut output).is_err() {
        return false;
    }
    let Some((headers, body)) = output.split_once("\r\n\r\n") else {
        return false;
    };
    if !headers.starts_with("HTTP/1.1 200") {
        return false;
    }
    // Health payload is explicitly from the actual Memory service. We do not
    // accept a mere open TCP listener as 'healthy'.
    let Ok(health) = serde_json::from_str::<Value>(body) else {
        return false;
    };
    health["ok"] == true
        && health["storage"]["ready"] == true
        && health["protocolVersion"].is_number()
        && health["serviceVersion"].is_string()
}

#[cfg(debug_assertions)]
fn launch_development_memory(data_dir: &Path) -> Result<(Child, String, String), String> {
    ensure_managed_data_dir(data_dir)?;
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/memory.mjs");
    if !script.is_file() {
        return Err("Memory development sidecar missing; build Memory first".into());
    }
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "cannot find a local Memory port")?;
    let port = listener
        .local_addr()
        .map_err(|_| "invalid Memory port")?
        .port();
    drop(listener); // Memory binds this reserved-for-us port immediately.
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let url = format!("http://127.0.0.1:{port}");
    let mut command = Command::new("node");
    command.arg(script);
    let mut child = command
        .env("MEMMY_TAURI_DATA_DIR", data_dir)
        .env("MEMMY_TAURI_MEMORY_PORT", port.to_string())
        .env("MEMMY_TAURI_DEV_BACKEND", "1")
        .env("MEMMY_MEMORY_TOKEN", &token)
        .env("MEMMY_MEMORY_LAYER_TOKEN", &token)
        .env("MEMMY_MEMORY_MODE", "local")
        .env("MEMMY_MEMORY_BACKEND", "sqlite")
        .env("MEMMY_MEMORY_DB", data_dir.join("memory.sqlite"))
        .env("MEMMY_MEMORY_URL", &url)
        .env("MEMMY_CONFIG", data_dir.join("config.yaml"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "cannot launch managed Memory service")?;
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if memory_is_ready(port, &token) {
            return Ok((child, url, token));
        }
        if !matches!(child.try_wait(), Ok(None)) {
            stop_child(&mut child);
            return Err("managed Memory service exited before health was ready".into());
        }
        if Instant::now() >= deadline {
            stop_child(&mut child);
            return Err("managed Memory service health timed out".into());
        }
        std::thread::sleep(Duration::from_millis(120));
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
fn launch_development_backend(
    data_dir: &Path,
    memory: Option<(&str, &str)>,
) -> Result<(Child, Value), String> {
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
    let mut command = Command::new("node");
    command.arg(script);
    if let Some((url, token)) = memory {
        command
            .env("MEMMY_MEMORY_LAYER_URL", url)
            .env("MEMMY_MEMORY_LAYER_TOKEN", token)
            .env("MEMMY_MEMORY_URL", url)
            .env("MEMMY_MEMORY_TOKEN", token);
    }
    let mut child = command
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
    #[cfg(debug_assertions)]
    use super::ensure_managed_data_dir;
    #[cfg(debug_assertions)]
    use super::{launch_development_memory, memory_is_ready, stop_child};
    use super::{parse_ready_line, NativeRuntime};
    use serde_json::json;
    #[cfg(debug_assertions)]
    use std::fs;
    #[test]
    #[cfg(debug_assertions)]
    fn real_backend_and_memory_rust_owner_smoke_when_opted_in() {
        if std::env::var("MEMMY_TAURI_TEST_FULL_RUNTIME").as_deref() != Ok("1") {
            return;
        }
        let directory =
            std::env::temp_dir().join(format!("memmy-tauri-full-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            let runtime = NativeRuntime::default();
            let config = runtime.config(&directory)?;
            let api_url = config["baseUrl"].as_str().ok_or("API URL missing")?;
            let memory_url = config["memory"]["baseUrl"]
                .as_str()
                .ok_or("Memory URL missing")?;
            assert!(api_url.starts_with("http://127.0.0.1:"));
            assert!(memory_url.starts_with("http://127.0.0.1:"));
            let port = api_url.rsplit(':').next().unwrap().parse::<u16>().unwrap();
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
            assert!(std::net::TcpStream::connect_timeout(
                &addr,
                std::time::Duration::from_millis(500)
            )
            .is_ok());
            runtime.stop();
            assert!(std::net::TcpStream::connect_timeout(
                &addr,
                std::time::Duration::from_millis(500)
            )
            .is_err());
            assert!(runtime.config(&directory).is_err());
            Ok::<(), String>(())
        })();
        let _ = fs::remove_dir_all(&directory);
        result.expect("Rust must own both Memory and Local API lifecycle");
    }

    #[test]
    #[cfg(debug_assertions)]
    fn real_memory_sidecar_rust_owner_smoke_when_opted_in() {
        if std::env::var("MEMMY_TAURI_TEST_REAL_MEMORY").as_deref() != Ok("1") {
            return;
        }
        let path =
            std::env::temp_dir().join(format!("memmy-tauri-rust-e2e-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            let (mut child, url, token) = launch_development_memory(&path)?;
            let port: u16 = url.rsplit(':').next().unwrap().parse().unwrap();
            assert!(
                memory_is_ready(port, &token),
                "Rust supervisor must see healthy real Memory"
            );
            stop_child(&mut child);
            assert!(
                !memory_is_ready(port, &token),
                "Memory must close after Rust supervisor stop"
            );
            Ok::<(), String>(())
        })();
        let _ = fs::remove_dir_all(&path);
        result.expect("native Rust Memory start / health / stop must pass");
    }

    #[test]
    #[cfg(debug_assertions)]
    fn creates_private_config_and_never_overwrites_existing_preferences() {
        let directory =
            std::env::temp_dir().join(format!("memmy-tauri-memory-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            ensure_managed_data_dir(&directory).unwrap();
            let config = directory.join("config.yaml");
            let first = fs::read_to_string(&config).unwrap();
            assert!(first.contains("autoScanKnownAgents"));
            assert!(first.contains("false"));
            fs::write(&config, "user-owned: preserved\n").unwrap();
            ensure_managed_data_dir(&directory).unwrap();
            assert_eq!(
                fs::read_to_string(&config).unwrap(),
                "user-owned: preserved\n"
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                fs::remove_file(&config).unwrap();
                symlink("/etc/hosts", &config).unwrap();
                assert!(ensure_managed_data_dir(&directory).is_err());
            }
        })();
        let _ = fs::remove_dir_all(&directory);
        result
    }

    #[cfg(debug_assertions)]
    #[test]
    fn rust_supervises_real_memory_when_explicitly_requested() {
        if std::env::var("MEMMY_TAURI_REAL_MEMORY_TEST").as_deref() != Ok("1") {
            return;
        }
        let root =
            std::env::temp_dir().join(format!("tauri-memory-supervisor-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            let (mut child, url, token) = super::launch_development_memory(&root)?;
            let port = url.rsplit(':').next().unwrap().parse::<u16>().unwrap();
            assert!(
                super::memory_is_ready(port, &token),
                "memory HTTP readiness not verified by Rust"
            );
            super::stop_child(&mut child);
            assert!(
                !super::memory_is_ready(port, &token),
                "memory child must stop with owner"
            );
            Ok::<(), String>(())
        })();
        let _ = std::fs::remove_dir_all(&root);
        result.unwrap();
    }

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
