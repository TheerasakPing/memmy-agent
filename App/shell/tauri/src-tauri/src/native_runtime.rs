//! Rust-managed local API child for Tauri. No arbitrary command from the webview.
//! Development starts a known repository entry; packaged builds fail closed
//! until signed cross-platform sidecars and the Memory/Agent stack are ready.
use crate::native_browser_surface::{BrowserSurfaceStore, EVENT_PREFIX};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::is_loopback_runtime_config;

const READY_PREFIX: &str = "MEMMY_TAURI_READY ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// Native runtime entrypoints are chosen by the application, not by webview IPC.
struct RuntimePaths {
    node: PathBuf,
    sidecar: PathBuf,
    bundled: bool,
}

fn runtime_paths(bundled_root: Option<&Path>) -> Result<RuntimePaths, String> {
    if let Some(root) = bundled_root {
        let node = root.join("node");
        let sidecar = root.join("App/shell/tauri/sidecar");
        for path in [
            &node,
            &sidecar.join("memory.mjs"),
            &sidecar.join("backend.mjs"),
            &sidecar.join("gateway.mjs"),
            &root.join("Memory/dist/src/server/index.js"),
            &root.join("App/backend/dist/src/index.js"),
            &root.join("App/memmy-agent/dist/main.js"),
        ] {
            let info =
                fs::symlink_metadata(path).map_err(|_| "bundled runtime payload incomplete")?;
            if info.file_type().is_symlink() || !info.is_file() {
                return Err("bundled runtime contains missing or symbolic-link entrypoint".into());
            }
        }
        return Ok(RuntimePaths {
            node,
            sidecar,
            bundled: true,
        });
    }
    #[cfg(debug_assertions)]
    {
        Ok(RuntimePaths {
            node: PathBuf::from("node"),
            sidecar: Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar"),
            bundled: false,
        })
    }
    #[cfg(not(debug_assertions))]
    {
        Err("Bundled native runtime unavailable; installer is incomplete".into())
    }
}

#[derive(Default)]
struct BackendState {
    process: Option<Child>,
    memory: Option<Child>,
    gateway: Option<Child>,
    config: Option<Value>,
    memory_export_auth: Option<(String, String)>,
    stopped_unexpectedly: bool,
}

#[derive(Default)]
pub struct NativeRuntime {
    state: Mutex<BackendState>,
    browser_surfaces: BrowserSurfaceStore,
    event_app: Mutex<Option<AppHandle>>,
}

impl NativeRuntime {
    pub fn attach_app(&self, app: AppHandle) {
        if let Ok(mut current) = self.event_app.lock() {
            *current = Some(app);
        }
    }

    // Never serializes the bearer token to React: the authenticated export request
    // is issued exclusively by trusted Rust after validating a live managed child.
    pub fn memory_export_auth(&self) -> Result<(String, String), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Memory service lock unavailable")?;
        if state.stopped_unexpectedly {
            return Err("managed Memory runtime requires restart".into());
        }
        let Some(child) = state.memory.as_mut() else {
            return Err("managed Memory service not ready".into());
        };
        if !matches!(child.try_wait(), Ok(None)) {
            return Err("managed Memory service no longer running".into());
        }
        state
            .memory_export_auth
            .clone()
            .ok_or("managed Memory session not ready".into())
    }

    pub fn browser_surface(&self, session_key: &str) -> Option<Value> {
        self.browser_surfaces.get(session_key)
    }

    pub fn send_browser_surface_action(
        &self,
        session_key: &str,
        action: &Value,
    ) -> Result<bool, String> {
        let Some(line) = self.browser_surfaces.action_line(session_key, action) else {
            return Ok(false);
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| "native Gateway unavailable")?;
        let Some(gateway) = state.gateway.as_mut() else {
            return Ok(false);
        };
        if !matches!(gateway.try_wait(), Ok(None)) {
            self.browser_surfaces.clear();
            return Ok(false);
        }
        let Some(stdin) = gateway.stdin.as_mut() else {
            return Ok(false);
        };
        stdin
            .write_all(line.as_bytes())
            .map_err(|_| "native Gateway action pipe disconnected")?;
        stdin
            .flush()
            .map_err(|_| "native Gateway action pipe unresponsive")?;
        Ok(true)
    }

    pub fn config(&self, data_dir: &Path, bundled_root: Option<&Path>) -> Result<Value, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "native runtime lock unavailable")?;
        if let Some(gateway) = state.gateway.as_mut() {
            if !matches!(gateway.try_wait(), Ok(None)) {
                if let Some(mut backend) = state.process.take() {
                    stop_child(&mut backend);
                }
                if let Some(mut memory) = state.memory.take() {
                    stop_child(&mut memory);
                }
                state.gateway.take();
                self.browser_surfaces.clear();
                state.config = None;
                state.stopped_unexpectedly = true;
                return Err("Tauri Agent Gateway stopped unexpectedly; restart the app".into());
            }
        }
        if let Some(memory) = state.memory.as_mut() {
            if !matches!(memory.try_wait(), Ok(None)) {
                if let Some(mut backend) = state.process.take() {
                    stop_child(&mut backend);
                }
                state.memory.take();
                if let Some(mut gateway) = state.gateway.take() {
                    stop_child(&mut gateway);
                }
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
                    if let Some(mut gateway) = state.gateway.take() {
                        stop_child(&mut gateway);
                    }
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
        #[cfg(debug_assertions)]
        if bundled_root.is_none() && std::env::var("MEMMY_TAURI_DEV_BACKEND").as_deref() != Ok("1")
        {
            return Err("Tauri development runtime disabled; set MEMMY_TAURI_DEV_BACKEND=1".into());
        }
        let paths = runtime_paths(bundled_root)?;
        let manage_memory =
            bundled_root.is_some() || std::env::var("MEMMY_TAURI_DEV_MEMORY").as_deref() == Ok("1");
        let manage_gateway = bundled_root.is_some()
            || std::env::var("MEMMY_TAURI_DEV_GATEWAY").as_deref() == Ok("1");
        let mut memory = if manage_memory {
            Some(launch_development_memory(data_dir, &paths)?)
        } else {
            None
        };
        let backend_result = launch_development_backend(
            data_dir,
            memory
                .as_ref()
                .map(|(_, url, token)| (url.as_str(), token.as_str())),
            &paths,
        );
        match backend_result {
            Ok((mut child, mut config)) => {
                let mut gateway = None;
                if manage_gateway {
                    let Some((_, url, token)) = memory.as_ref() else {
                        stop_child(&mut child);
                        return Err("Tauri Agent requires managed Memory".into());
                    };
                    match launch_development_gateway(
                        data_dir,
                        url,
                        token,
                        &paths,
                        self.browser_surfaces.clone(),
                        self.event_app.lock().ok().and_then(|app| app.clone()),
                    ) {
                        Ok((process, metadata)) => {
                            config["agentGateway"] = metadata;
                            gateway = Some(process);
                        }
                        Err(err) => {
                            stop_child(&mut child);
                            if let Some((mut process, _, _)) = memory.take() {
                                stop_child(&mut process);
                            }
                            return Err(err);
                        }
                    }
                }
                state.process = Some(child);
                state.memory_export_auth = memory
                    .as_ref()
                    .map(|(_, url, token)| (url.clone(), token.clone()));
                state.memory = memory.take().map(|(process, _, _)| process);
                state.gateway = gateway;
                state.config = Some(config.clone());
                Ok(config)
            }
            Err(err) => {
                if let Some((mut process, _, _)) = memory.take() {
                    stop_child(&mut process);
                }
                Err(err)
            }
        }
    }

    /// Observability allowlist: child registration only, not service health or credentials.
    pub fn diagnostic_child_registrations(&self) -> Result<[bool; 3], String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "runtime diagnostics unavailable")?;
        Ok([
            state.process.is_some(),
            state.memory.is_some(),
            state.gateway.is_some(),
        ])
    }

    pub fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(mut gateway) = state.gateway.take() {
                stop_child(&mut gateway);
            }
            if let Some(mut process) = state.process.take() {
                stop_child(&mut process);
            }
            if let Some(mut memory) = state.memory.take() {
                stop_child(&mut memory);
            }
            state.config = None;
            state.memory_export_auth = None;
            state.stopped_unexpectedly = true;
            self.browser_surfaces.clear();
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

fn launch_development_memory(
    data_dir: &Path,
    paths: &RuntimePaths,
) -> Result<(Child, String, String), String> {
    ensure_managed_data_dir(data_dir)?;
    let script = paths.sidecar.join("memory.mjs");
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
    let mut command = Command::new(&paths.node);
    command.arg(script);
    // In a Finder-launched packaged preview there is no inherited shell cloud env.
    // This only selects the same historical default as the existing edition config;
    // it does not imply external cloud login has been verified.
    if paths.bundled
        && std::env::var_os("MEMMY_CLOUD_SERVICE").is_none()
        && std::env::var_os("MEMMY_CLOUD_URL").is_none()
    {
        command.env("MEMMY_CLOUD_SERVICE", "https://api.memmy.cn");
    }
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

fn launch_development_backend(
    data_dir: &Path,
    memory: Option<(&str, &str)>,
    paths: &RuntimePaths,
) -> Result<(Child, Value), String> {
    let script = paths.sidecar.join("backend.mjs");
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
    let mut command = Command::new(&paths.node);
    command.arg(script);
    // Finder-launched applications have no terminal environment. Match the
    // existing default cloud service for the configured international edition;
    // the app must still authenticate before cloud operations can succeed.
    if paths.bundled
        && std::env::var_os("MEMMY_CLOUD_SERVICE").is_none()
        && std::env::var_os("MEMMY_CLOUD_URL").is_none()
    {
        command.env("MEMMY_CLOUD_SERVICE", "https://api.memmy.cn");
    }
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

fn launch_development_gateway(
    data_dir: &Path,
    memory_url: &str,
    token: &str,
    paths: &RuntimePaths,
    surfaces: BrowserSurfaceStore,
    event_app: Option<AppHandle>,
) -> Result<(Child, Value), String> {
    let script = paths.sidecar.join("gateway.mjs");
    if !script.is_file() {
        return Err("Agent development gateway helper missing".into());
    }
    let choose_port = || -> Result<u16, String> {
        let port = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|_| "cannot reserve local Agent port")?
            .local_addr()
            .map_err(|_| "Agent port unavailable")?
            .port();
        Ok(port)
    };
    let ws_port = choose_port()?;
    let mut health_port = choose_port()?;
    while health_port == ws_port {
        health_port = choose_port()?;
    }
    let mut command = Command::new(&paths.node);
    command.arg(script);
    // The real Agent child inherits this env from its managed shim. A Finder
    // process does not inherit shell environment variables, so the bundled
    // preview must configure its service origin at the Gateway boundary too.
    if paths.bundled
        && std::env::var_os("MEMMY_CLOUD_SERVICE").is_none()
        && std::env::var_os("MEMMY_CLOUD_URL").is_none()
    {
        command.env("MEMMY_CLOUD_SERVICE", "https://api.memmy.cn");
    }
    let mut child = command
        .env("MEMMY_TAURI_DATA_DIR", data_dir)
        .env("MEMMY_TAURI_DEV_GATEWAY", "1")
        // Enabled only for this trusted, Rust-owned native Gateway process.
        // Unknown Agent approvals fail closed in the wrapper; no renderer-set flag.
        .env("MEMMY_TAURI_BROWSER_SURFACE_RELAY", "1")
        .env(
            "MEMMY_NATIVE_APP_ALLOW_ALL_FILE",
            data_dir.join("computer-use/allow-all-apps.json"),
        )
        .env("MEMMY_TAURI_GATEWAY_WS_PORT", ws_port.to_string())
        .env("MEMMY_TAURI_GATEWAY_HEALTH_PORT", health_port.to_string())
        .env("MEMMY_MEMORY_URL", memory_url)
        .env("MEMMY_MEMORY_TOKEN", token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "cannot start Agent development helper")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Agent readiness pipe unavailable")?;
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut notified = false;
        while let Ok(size) = reader.read_line(&mut line) {
            if size == 0 {
                break;
            }
            if notified && line.starts_with(EVENT_PREFIX) {
                if let Some(message) = surfaces.update(
                    line.trim_end_matches(['\r', '\n'])
                        .trim_start_matches(EVENT_PREFIX),
                ) {
                    if let Some(app) = event_app.as_ref() {
                        let _ = app.emit_to("main", "memmy:browser-sidebar:surface", message);
                    }
                }
            }
            if !notified && line.starts_with("MEMMY_TAURI_GATEWAY_READY ") {
                notified = true;
                let decoded = serde_json::from_str::<Value>(
                    line.trim_end_matches(['\r', '\n'])
                        .trim_start_matches("MEMMY_TAURI_GATEWAY_READY "),
                );
                let result = decoded
                    .map_err(|_| "invalid Agent readiness JSON".to_string())
                    .and_then(|value| {
                        let url = value["baseUrl"].as_str().ok_or("missing Agent URL")?;
                        let auth = value["bootstrapSecret"]
                            .as_str()
                            .ok_or("missing Agent bootstrap secret")?;
                        if url != format!("http://127.0.0.1:{ws_port}") || auth.len() < 32 {
                            return Err("invalid Agent endpoint or secret".to_string());
                        }
                        Ok(value)
                    });
                let _ = tx.send(result.map_err(|error| error.to_string()));
            }
            line.clear();
        }
        // Prevent stale screenshot/action sessions when the managed Agent exits.
        for closed in surfaces.clear() {
            if let Some(app) = event_app.as_ref() {
                let _ = app.emit_to("main", "memmy:browser-sidebar:surface", closed);
            }
        }
        if !notified {
            let _ = tx.send(Err("Agent Gateway exited before readiness".into()));
        }
    });
    match rx.recv_timeout(Duration::from_secs(52)) {
        Ok(Ok(metadata)) => Ok((child, metadata)),
        other => {
            stop_child(&mut child);
            Err(match other {
                Ok(Err(message)) => message,
                Err(_) => "Agent Gateway readiness timeout".into(),
                _ => "Agent Gateway unavailable".into(),
            })
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
            let config = runtime.config(&directory, None)?;
            let api_url = config["baseUrl"].as_str().ok_or("API URL missing")?;
            let memory_url = config["memory"]["baseUrl"]
                .as_str()
                .ok_or("Memory URL missing")?;
            assert!(api_url.starts_with("http://127.0.0.1:"));
            assert!(memory_url.starts_with("http://127.0.0.1:"));
            if std::env::var("MEMMY_TAURI_DEV_GATEWAY").as_deref() == Ok("1") {
                let gateway = &config["agentGateway"];
                assert!(gateway["baseUrl"]
                    .as_str()
                    .is_some_and(|url| url.starts_with("http://127.0.0.1:")));
                assert!(gateway["bootstrapSecret"]
                    .as_str()
                    .is_some_and(|secret| secret.len() >= 32));
            }
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
            assert!(runtime.config(&directory, None).is_err());
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
            let (mut child, url, token) =
                launch_development_memory(&path, &super::runtime_paths(None)?)?;
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
            let (mut child, url, token) =
                super::launch_development_memory(&root, &super::runtime_paths(None)?)?;
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
            .config(std::path::Path::new("/tmp/does-not-exist"), None)
            .is_err());
    }
}
