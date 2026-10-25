//! Native browser tabs are child WebViews inside the original React Tauri main window.
//! Remote pages have no native IPC capability and cannot choose commands or file paths.
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
};
use url::Url;
use uuid::Uuid;

#[derive(Default)]
struct NativeTabVisit {
    title: String,
    last_user_navigation: Option<std::time::Instant>,
}
#[derive(Default)]
pub struct NativeBrowsers(Mutex<HashMap<String, NativeTabVisit>>);

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
}

fn browser_url(raw: &str) -> Result<Url, String> {
    if raw == "about:blank" {
        return Url::parse(raw).map_err(|_| "invalid blank tab".into());
    }
    let url = Url::parse(raw).map_err(|_| "invalid browser URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.username() != ""
        || url.password().is_some()
        || url.host_str().is_none()
        || raw.len() > 8192
    {
        return Err("browser only accepts normal HTTP(S) URLs without credentials".into());
    }
    Ok(url)
}

fn allowed_popup(counter: &AtomicUsize, raw: &str) -> Option<Url> {
    let url = browser_url(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    counter
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
            (count < 8).then_some(count + 1)
        })
        .ok()?;
    Some(url)
}

fn validate_bounds(
    bounds: BrowserBounds,
    max_width: f64,
    max_height: f64,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>, bool), String> {
    let values = [
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        max_width,
        max_height,
    ];
    if values.iter().any(|v| !v.is_finite())
        || max_width <= 0.0
        || max_height <= 0.0
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 0.0
        || bounds.height < 0.0
        || bounds.x > max_width + 1.0
        || bounds.y > max_height + 1.0
    {
        return Err("native browser bounds invalid".into());
    }
    let width = bounds.width.min((max_width - bounds.x).max(0.0));
    let height = bounds.height.min((max_height - bounds.y).max(0.0));
    Ok((
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
        bounds.visible && width >= 16.0 && height >= 16.0,
    ))
}

fn main_guard(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("native browser commands require main application window".into())
    }
}

fn owned_label(state: &NativeBrowsers, id: &str) -> Result<String, String> {
    if id.len() > 64 || Uuid::parse_str(id).is_err() {
        return Err("invalid native browser identifier".into());
    }
    let guard = state.0.lock().map_err(|_| "browser registry unavailable")?;
    if !guard.contains_key(id) {
        return Err("unregistered native browser tab".into());
    }
    Ok(format!("memmy-browser-{id}"))
}

#[tauri::command]
pub async fn desktop_native_browser_create(
    app: AppHandle,
    window: WebviewWindow,
    browsers: tauri::State<'_, NativeBrowsers>,
    initial_url: String,
    bounds: BrowserBounds,
) -> Result<String, String> {
    main_guard(&window)?;
    let url = browser_url(&initial_url)?;
    let width_height = window
        .inner_size()
        .map_err(|_| "main window dimensions unavailable")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "window scale unavailable")?;
    let (position, size, show) = validate_bounds(
        bounds,
        f64::from(width_height.width) / scale,
        f64::from(width_height.height) / scale,
    )?;
    let id = Uuid::new_v4().to_string();
    let label = format!("memmy-browser-{id}");
    {
        let mut registry = browsers
            .0
            .lock()
            .map_err(|_| "browser registry unavailable")?;
        if registry.len() >= 10 {
            return Err("maximum native browser tabs reached".into());
        }
        registry.insert(id.clone(), NativeTabVisit::default());
    }
    let event_id = id.clone();
    let app_for_load = app.clone();
    let app_for_title = app.clone();
    let history_id = id.clone();
    let title_registry_id = id.clone();
    let app_for_popup = app.clone();
    // Cap page-authored window.open requests so an untrusted page cannot flood
    // the trusted React Browser tab queue.
    let popup_count = Arc::new(AtomicUsize::new(0));
    let load_id = event_id.clone();
    let title_id = event_id;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .on_navigation(|candidate| browser_url(candidate.as_str()).is_ok())
        .on_new_window(move |candidate, _features| {
            if let Some(url) = allowed_popup(&popup_count, candidate.as_str()) {
                // The page gets NO Tauri IPC; its safe URL is sent to first-party React.
                let _ = app_for_popup.emit_to(
                    "main",
                    "memmy:browser:open-url",
                    json!({"url":url.as_str()}),
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_view, payload| {
            // The native WebKit tab has not been granted Agent Playwright/CDP access.
            // Record its actual page loads as "other", never fabricated Agent visits.
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let url = payload.url().as_str().to_string();
                let title = app_for_load
                    .state::<NativeBrowsers>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|mut registry| {
                        registry.get_mut(&history_id).map(|entry| {
                            // Consume explicit user-origin navigation. This child is not
                            // an Agent Playwright context, so provenance remains "other".
                            let _user_marked_recently =
                                entry.last_user_navigation.take().is_some_and(|at| {
                                    at.elapsed() <= std::time::Duration::from_secs(10)
                                });
                            entry.title.clone()
                        })
                    });
                if let Some(title) = title {
                    if browser_url(&url)
                        .is_ok_and(|candidate| matches!(candidate.scheme(), "http" | "https"))
                    {
                        let app = app_for_load.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            if let Ok(folder) = crate::native_browser_store::browser_folder(&app) {
                                let _ = crate::native_browser_store::record_native_visit(
                                    &folder.join("history.json"),
                                    &url,
                                    &title,
                                    "other",
                                );
                            }
                        });
                    }
                }
            }
            let kind = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            let _ = app_for_load.emit_to(
                "main",
                "memmy:native-browser:event",
                json!({"id":load_id,"kind":kind,"url":payload.url().as_str()}),
            );
        })
        .on_document_title_changed(move |_view, title| {
            if let Ok(mut registry) = app_for_title.state::<NativeBrowsers>().0.lock() {
                if let Some(tab) = registry.get_mut(&title_registry_id) {
                    tab.title = title.chars().take(256).collect();
                }
            }
            let _ = app_for_title.emit_to(
                "main",
                "memmy:native-browser:event",
                json!({"id":title_id,"kind":"title","title":title}),
            );
        });
    let result = app
        .get_window("main")
        .ok_or("native main window missing")?
        .add_child(builder, position, size);
    match result {
        Ok(view) => {
            if !show {
                let _ = view.hide();
            }
            Ok(id)
        }
        Err(_) => {
            if let Ok(mut registry) = browsers.0.lock() {
                registry.remove(&id);
            }
            Err("cannot create native browser child WebView".into())
        }
    }
}

#[tauri::command]
pub fn desktop_native_browser_bounds(
    app: AppHandle,
    window: WebviewWindow,
    browsers: tauri::State<'_, NativeBrowsers>,
    id: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    main_guard(&window)?;
    let label = owned_label(&browsers, &id)?;
    let view = app
        .get_webview(&label)
        .ok_or("native browser WebView missing")?;
    let main_size = window
        .inner_size()
        .map_err(|_| "main window dimensions unavailable")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "window scale unavailable")?;
    let (position, size, show) = validate_bounds(
        bounds,
        f64::from(main_size.width) / scale,
        f64::from(main_size.height) / scale,
    )?;
    view.set_position(position)
        .map_err(|_| "browser position change failed")?;
    view.set_size(size).map_err(|_| "browser resize failed")?;
    if show { view.show() } else { view.hide() }
        .map_err(|_| "browser visibility change failed".into())
}

#[tauri::command]
pub fn desktop_native_browser_action(
    app: AppHandle,
    window: WebviewWindow,
    browsers: tauri::State<'_, NativeBrowsers>,
    id: String,
    action: String,
    url: Option<String>,
) -> Result<(), String> {
    main_guard(&window)?;
    let label = owned_label(&browsers, &id)?;
    let view = app
        .get_webview(&label)
        .ok_or("native browser WebView missing")?;
    match action.as_str() {
        "navigate" => view
            .navigate(browser_url(
                url.as_deref().ok_or("navigation URL missing")?,
            )?)
            .map_err(|_| "browser navigation failed".into()),
        "reload" => view.reload().map_err(|_| "browser reload failed".into()),
        "back" => view
            .eval("window.history.back()")
            .map_err(|_| "browser back failed".into()),
        "forward" => view
            .eval("window.history.forward()")
            .map_err(|_| "browser forward failed".into()),
        _ => Err("unsupported native browser action".into()),
    }
}

#[tauri::command]
pub fn desktop_native_browser_mark_user_navigation(
    window: WebviewWindow,
    browsers: tauri::State<'_, NativeBrowsers>,
    id: String,
) -> Result<(), String> {
    main_guard(&window)?;
    let _ = owned_label(&browsers, &id)?;
    let mut registry = browsers
        .0
        .lock()
        .map_err(|_| "native browser registry unavailable")?;
    let tab = registry
        .get_mut(&id)
        .ok_or("native browser tab no longer exists")?;
    tab.last_user_navigation = Some(std::time::Instant::now());
    Ok(())
}

#[tauri::command]
pub fn desktop_native_browser_destroy(
    app: AppHandle,
    window: WebviewWindow,
    browsers: tauri::State<'_, NativeBrowsers>,
    id: String,
) -> Result<(), String> {
    main_guard(&window)?;
    let label = owned_label(&browsers, &id)?;
    let view = app
        .get_webview(&label)
        .ok_or("native browser WebView missing")?;
    view.close()
        .map_err(|_| "cannot close native browser WebView")?;
    let mut registry = browsers
        .0
        .lock()
        .map_err(|_| "browser registry unavailable")?;
    registry.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_never_allow_javascript_file_credentials_or_browser_internal_pages() {
        for input in [
            "javascript:alert(1)",
            "file:///private/key",
            "data:text/html,hi",
            "https://a:b@example.com/",
            "chrome://settings",
            "https://",
            "about:config",
            "https://example.com:bad",
        ] {
            assert!(browser_url(input).is_err(), "{input}");
        }
        for url in [
            "about:blank",
            "https://example.org/page",
            "http://127.0.0.1:9090/",
        ] {
            assert!(browser_url(url).is_ok(), "{url}");
        }
    }
    #[test]
    fn webview_popup_open_urls_must_be_http_or_https_without_credentials() {
        for raw in [
            "about:blank",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,evil",
            "chrome://settings",
            "https://user:pass@site.test/",
        ] {
            assert!(
                !browser_url(raw).is_ok_and(|url| matches!(url.scheme(), "http" | "https")),
                "{raw}"
            );
        }
        assert_eq!(
            browser_url("https://example.org/new-tab").unwrap().scheme(),
            "https"
        );
    }
    #[test]
    fn browser_popup_rate_limit_cannot_be_exhausted_by_invalid_urls() {
        let counter = AtomicUsize::new(0);
        for raw in [
            "about:blank",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:pass@example.org/",
        ] {
            assert!(allowed_popup(&counter, raw).is_none());
        }
        assert_eq!(counter.load(Ordering::SeqCst), 0);
        for _ in 0..8 {
            assert!(allowed_popup(&counter, "https://example.org/new").is_some());
        }
        assert!(allowed_popup(&counter, "https://example.org/ninth").is_none());
        assert_eq!(counter.load(Ordering::SeqCst), 8);
    }
    #[test]
    fn native_browser_bounds_reject_escaping_or_non_finite_geometry() {
        let valid = BrowserBounds {
            x: 10.0,
            y: 70.0,
            width: 320.0,
            height: 200.0,
            visible: true,
        };
        assert!(validate_bounds(valid, 1200.0, 780.0).unwrap().2);
        assert!(
            !validate_bounds(
                BrowserBounds {
                    visible: false,
                    ..valid
                },
                1200.0,
                780.0
            )
            .unwrap()
            .2
        );
        assert!(validate_bounds(
            BrowserBounds {
                x: f64::NAN,
                ..valid
            },
            1200.0,
            780.0
        )
        .is_err());
        assert!(validate_bounds(BrowserBounds { x: -100.0, ..valid }, 1200.0, 780.0).is_err());
        assert!(validate_bounds(BrowserBounds { x: 1230.0, ..valid }, 1200.0, 780.0).is_err());
        let clipped = validate_bounds(BrowserBounds { x: 1180.0, ..valid }, 1200.0, 780.0).unwrap();
        assert_eq!(clipped.1.width, 20.0);
    }
    #[test]
    fn random_and_unknown_tab_handles_are_rejected() {
        let state = NativeBrowsers::default();
        assert!(owned_label(&state, "not-a-uuid").is_err());
        assert!(owned_label(&state, &Uuid::new_v4().to_string()).is_err());
    }
}
