//! Authenticated, size-bounded Memory HTTP export, owned by the native supervisor.
//! No renderer URL, bearer credential, arbitrary filesystem path or database copy.
use reqwest::{blocking::Client, redirect::Policy};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::native_runtime::NativeRuntime;

const MAX_MEMORY_EXPORT_BYTES: u64 = 128 * 1024 * 1024;
fn trusted_endpoint(base: &str, token: &str) -> Result<String, String> {
    let url = url::Url::parse(base).map_err(|_| "managed Memory URL malformed")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || token.len() != 64
        || !token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("managed Memory endpoint must be private loopback HTTP".into());
    }
    Ok(format!("{}api/v1/admin/export", url.as_str()))
}
fn download_export(base: &str, token: &str) -> Result<Vec<u8>, String> {
    // The Tauri signed-updater and managed Memory HTTP client share reqwest/
    // rustls. Register a single process-wide provider before either creates
    // a client, including when Memory tests run without GUI/updater startup.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let endpoint = trusted_endpoint(base, token)?;
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(40))
        .build()
        .map_err(|_| "native Memory HTTP client unavailable")?;
    let response = client
        .get(endpoint)
        .bearer_auth(token)
        .header("accept", "application/json")
        .send()
        .map_err(|_| "managed Memory service export request failed")?;
    if !response.status().is_success() {
        return Err(format!(
            "managed Memory export HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_MEMORY_EXPORT_BYTES)
    {
        return Err("Memory export exceeds 128 MiB".into());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MEMORY_EXPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Memory export response incomplete")?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_MEMORY_EXPORT_BYTES {
        return Err("Memory export is empty or exceeds 128 MiB".into());
    }
    let export: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Memory export is not valid JSON")?;
    if export.pointer("/manifest/service").and_then(Value::as_str) != Some("memmy-memory-service") {
        return Err("Memory export response has invalid service manifest".into());
    }
    Ok(bytes)
}
fn save_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !path.is_absolute() || path.extension().is_none_or(|ext| ext != "json") {
        return Err(
            "Memory export save path must be an absolute .json selected by native picker".into(),
        );
    }
    let parent = path
        .parent()
        .ok_or("Memory export destination missing parent")?;
    let info = fs::symlink_metadata(parent).map_err(|_| "Memory export parent unavailable")?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err("Memory export parent must be a real directory".into());
    }
    match fs::symlink_metadata(path) {
        Ok(info) if !info.is_file() || info.file_type().is_symlink() => {
            return Err("Memory export destination is unsafe".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Memory export destination cannot be inspected".into()),
        _ => {}
    }
    let tmp = parent.join(format!(".memmy-memory-export-{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut handle = options
        .open(&tmp)
        .map_err(|_| "Memory export cannot create temporary output")?;
    let result = handle
        .write_all(bytes)
        .and_then(|_| handle.sync_all())
        .and_then(|_| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return Err("Memory export could not be committed".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_export_memory_database(
    app: AppHandle,
    window: WebviewWindow,
    supervisor: tauri::State<'_, Arc<NativeRuntime>>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Memory export requires first-party main app window".into());
    }
    let runtime = supervisor.inner().clone();
    let name = format!(
        "memmy-memory-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = runtime.memory_export_auth()?;
        let mut picker = app
            .dialog()
            .file()
            .set_file_name(name)
            .add_filter("Memmy Memory JSON", &["json"]);
        if let Ok(dir) = app.path().document_dir() {
            picker = picker.set_directory(dir);
        }
        let Some(selection) = picker.blocking_save_file() else {
            return Ok(json!({"canceled":true}));
        };
        let destination = selection
            .into_path()
            .map_err(|_| "Memory save dialog did not return local path")?;
        // User selected a real native path. Only the Rust-owned Memory service
        // and its private token can generate the exported bytes.
        let data = download_export(&base, &token)?;
        save_export(&destination, &data)?;
        Ok(json!({"canceled":false,"exportPath":destination.to_string_lossy(),"bytes":data.len()}))
    })
    .await
    .map_err(|_| "native Memory export worker unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(debug_assertions)]
    fn real_managed_memory_export_when_opted_in() {
        if std::env::var("MEMMY_TAURI_TEST_FULL_RUNTIME").as_deref() != Ok("1") {
            return;
        }
        let root =
            std::env::temp_dir().join(format!("memmy-live-memory-export-{}", Uuid::new_v4()));
        let supervisor = NativeRuntime::default();
        let check = (|| -> Result<(), String> {
            supervisor.config(&root, None)?;
            let (base, token) = supervisor.memory_export_auth()?;
            let restarted = supervisor.restart_memory()?;
            if restarted["baseUrl"] != base {
                return Err("Memory restart changed original loopback URL".into());
            }
            let (after_url, after_token) = supervisor.memory_export_auth()?;
            if (after_url, after_token) != (base.clone(), token.clone()) {
                return Err("Memory restart invalidated active managed Agent bearer token".into());
            }
            let data = download_export(&base, &token)?;
            let json: Value =
                serde_json::from_slice(&data).map_err(|_| "invalid real Memory export JSON")?;
            if json["manifest"]["service"] != "memmy-memory-service" {
                return Err("authentic Memory service manifest mismatch".into());
            }
            let target = root.join("verified-export.json");
            save_export(&target, &data)?;
            if fs::read(&target).map_err(|_| "saved Memory export missing")? != data {
                return Err("exported Memory bundle was modified".into());
            }
            Ok(())
        })();
        supervisor.stop();
        let _ = fs::remove_dir_all(&root);
        check.expect("native Memory should export its real authenticated JSON bundle");
    }

    #[test]
    fn endpoint_never_accepts_remote_or_credential_leaking_urls() {
        let token = "a".repeat(64);
        let ok = trusted_endpoint("http://127.0.0.1:4567/", &token).unwrap();
        assert_eq!(ok, "http://127.0.0.1:4567/api/v1/admin/export");
        for url in [
            "http://localhost:4567/",
            "http://127.0.0.1:4567/other",
            "http://127.0.0.1:4567/?token=x",
            "https://127.0.0.1:4567/",
            "http://user:password@127.0.0.1:4567/",
            "file:///etc/passwd",
            "http://192.168.1.1:4567/",
        ] {
            assert!(trusted_endpoint(url, &token).is_err(), "{url}");
        }
        assert!(trusted_endpoint("http://127.0.0.1:4567/", "bad-token").is_err());
    }
    #[test]
    fn output_is_atomic_and_never_overwrites_destination_symlink() {
        let root = std::env::temp_dir().join(format!("memmy-export-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("memory.json");
        save_export(
            &destination,
            br#"{"manifest":{"service":"memmy-memory-service"}}"#,
        )
        .unwrap();
        assert!(fs::read_to_string(&destination)
            .unwrap()
            .contains("memmy-memory-service"));
        #[cfg(unix)]
        {
            fs::remove_file(&destination).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", &destination).unwrap();
            assert!(save_export(&destination, b"malicious").is_err());
        }
        assert!(save_export(&root.join("memory.txt"), b"data").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn actual_loopback_export_checks_auth_status_and_manifest() {
        use std::net::TcpListener;
        use std::thread;
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "a".repeat(64);
        let response_token = token.clone();
        let server = thread::spawn(move || {
            let (mut client, _) = listener.accept().unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            let mut incoming = [0u8; 4096];
            let n = client.read(&mut incoming).unwrap();
            let request = String::from_utf8_lossy(&incoming[..n]);
            assert!(request.starts_with("GET /api/v1/admin/export HTTP/1.1"));
            assert!(request
                .to_lowercase()
                .contains(&format!("authorization: bearer {response_token}")));
            let body = r#"{"manifest":{"service":"memmy-memory-service"},"memories":[]}"#;
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            client.write_all(reply.as_bytes()).unwrap();
        });
        let data = download_export(&format!("http://127.0.0.1:{port}/"), &token).unwrap();
        server.join().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&data).unwrap()["manifest"]["service"],
            "memmy-memory-service"
        );
    }
}
