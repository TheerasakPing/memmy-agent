//! Tauri v2 dedicated pet webview: reuses the original React renderer, with
//! the legacy memmyMode=pet launch query and independent floating window.
use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteTarget {
    route: Option<String>,
    hash: Option<String>,
    agent_chat_id: Option<String>,
    pet_intent: Option<String>,
}

fn valid_route(value: &str) -> bool {
    matches!(
        value,
        "/welcome"
            | "/token-detail"
            | "/login"
            | "/api-key"
            | "/api-key-models"
            | "/api-key-optional"
            | "/onboarding"
            | "/main"
            | "/tools"
            | "/memory"
            | "/memory-sources"
            | "/settings"
    )
}

fn validate_target(target: &RouteTarget) -> Result<(), String> {
    if target.route.as_deref().is_some_and(|v| !valid_route(v)) {
        return Err("unrecognized route target".into());
    }
    let valid_identifier = |input: &str, max: usize| {
        !input.is_empty()
            && input.len() <= max
            && input
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    if target
        .hash
        .as_deref()
        .is_some_and(|v| !valid_identifier(v, 80))
    {
        return Err("invalid route hash".into());
    }
    if target.agent_chat_id.as_deref().is_some_and(|v| {
        v.len() > 128
            || v.is_empty()
            || !v
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_:-".contains(c))
    }) {
        return Err("invalid Agent chat ID".into());
    }
    if target.pet_intent.as_deref().is_some_and(|v| v != "user") {
        return Err("invalid pet intent".into());
    }
    Ok(())
}

fn build_pet_query(target: Option<&RouteTarget>) -> Result<String, String> {
    if let Some(target) = target {
        validate_target(target)?;
    }
    let mut parsed = url::Url::parse("https://tauri.localhost/index.html")
        .map_err(|_| "pet renderer URL invalid")?;
    {
        let mut params = parsed.query_pairs_mut();
        params.append_pair("memmyMode", "pet");
        if let Some(target) = target {
            if let Some(ref route) = target.route {
                params.append_pair("memmyRoute", route);
            }
            if let Some(ref id) = target.agent_chat_id {
                params.append_pair("memmyAgentChat", id);
            }
            if let Some(ref intent) = target.pet_intent {
                params.append_pair("memmyPetIntent", intent);
            }
        }
    }
    if let Some(hash) = target.and_then(|v| v.hash.as_deref()) {
        parsed.set_fragment(Some(hash));
    }
    Ok(format!(
        "?{}{}",
        parsed.query().unwrap_or(""),
        parsed
            .fragment()
            .map(|fragment| format!("#{fragment}"))
            .unwrap_or_default()
    ))
}

#[tauri::command]
pub fn desktop_set_pet_window(
    app: AppHandle,
    enabled: bool,
    target: Option<RouteTarget>,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("main window unavailable")?;
    if !enabled {
        main.show().map_err(|_| "cannot show main window")?;
        let _ = main.set_focus();
        if let Some(target) = target {
            validate_target(&target)?;
            main.emit(
                "memmy:route-target-request",
                serde_json::json!({
                    "route": target.route, "hash": target.hash, "agentChatId": target.agent_chat_id
                }),
            )
            .map_err(|_| "cannot route to main window")?;
        }
        if let Some(pet) = app.get_webview_window("pet") {
            let _ = pet.close();
        }
        return Ok(());
    }
    let query = build_pet_query(target.as_ref())?;
    if let Some(pet) = app.get_webview_window("pet") {
        if target.is_some() {
            // Refresh a previously opened floating pet with the requested route;
            // do not silently ignore routing when the webview already exists.
            let mut location = pet.url().map_err(|_| "pet URL not available")?;
            let incoming = url::Url::parse(&format!("https://tauri.localhost/{query}"))
                .map_err(|_| "pet route URL invalid")?;
            location.set_query(incoming.query());
            location.set_fragment(incoming.fragment());
            pet.navigate(location)
                .map_err(|_| "unable to route existing pet window")?;
        } else {
            pet.show()
                .map_err(|_| "unable to show existing pet window")?;
        }
        return main
            .hide()
            .map_err(|_| "cannot switch to pet window".into());
    }
    if app.get_webview_window("pet").is_none() {
        let url = if cfg!(debug_assertions) {
            let url = format!("http://127.0.0.1:19000/{query}");
            WebviewUrl::External(url.parse().map_err(|_| "invalid development pet URL")?)
        } else {
            WebviewUrl::App(format!("index.html{query}").into())
        };
        WebviewWindowBuilder::new(&app, "pet", url)
            .title("Memmy Pet")
            .inner_size(160.0, 160.0)
            .min_inner_size(120.0, 120.0)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|_| "could not create pet webview")?;
    }
    // The pet remains invisible until its first validated renderer layout.
    main.hide()
        .map_err(|_| "cannot switch to pet window".to_string())
}

#[tauri::command]
pub fn desktop_hide_pet_window(app: AppHandle) -> Result<(), String> {
    if let Some(pet) = app.get_webview_window("pet") {
        pet.hide().map_err(|_| "cannot hide pet")?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetLayout {
    width: f64,
    height: f64,
    mascot_offset_x: f64,
    mascot_offset_y: f64,
}

fn validated_pet_size(value: &PetLayout) -> Result<PhysicalSize<u32>, String> {
    if !value.width.is_finite()
        || !value.height.is_finite()
        || !value.mascot_offset_x.is_finite()
        || !value.mascot_offset_y.is_finite()
        || !(120.0..=900.0).contains(&value.width)
        || !(120.0..=900.0).contains(&value.height)
        || value.mascot_offset_x < 0.0
        || value.mascot_offset_y < 0.0
        || value.mascot_offset_x > value.width
        || value.mascot_offset_y > value.height
    {
        return Err("invalid floating pet layout".into());
    }
    Ok(PhysicalSize::new(
        value.width.ceil() as u32,
        value.height.ceil() as u32,
    ))
}

#[tauri::command]
pub fn desktop_sync_pet_window_layout(
    window: WebviewWindow,
    layout: PetLayout,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("layout can only be sent by pet window".into());
    }
    let size = validated_pet_size(&layout)?;
    window
        .set_size(size)
        .map_err(|_| "cannot update pet size")?;
    window
        .show()
        .map_err(|_| "cannot reveal pet window".to_string())
}

#[tauri::command]
pub fn desktop_start_pet_window_drag(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("only pet webview can initiate drag".into());
    }
    window
        .start_dragging()
        .map_err(|_| "native pet drag failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pet_renderer_url_and_layout_are_strictly_validated() {
        assert_eq!(build_pet_query(None).unwrap(), "?memmyMode=pet");
        let invalid = RouteTarget {
            route: Some("javascript:evil".into()),
            hash: None,
            agent_chat_id: None,
            pet_intent: None,
        };
        assert!(build_pet_query(Some(&invalid)).is_err());
        let valid = RouteTarget {
            route: Some("/settings".into()),
            hash: Some("pet-avatar".into()),
            agent_chat_id: None,
            pet_intent: None,
        };
        assert!(build_pet_query(Some(&valid))
            .unwrap()
            .contains("memmyRoute=%2Fsettings"));
        assert_eq!(
            validated_pet_size(&PetLayout {
                width: 160.0,
                height: 160.0,
                mascot_offset_x: 0.0,
                mascot_offset_y: 0.0
            })
            .unwrap(),
            PhysicalSize::new(160, 160)
        );
        assert!(validated_pet_size(&PetLayout {
            width: f64::NAN,
            height: 160.0,
            mascot_offset_x: 0.0,
            mascot_offset_y: 0.0
        })
        .is_err());
        assert!(validated_pet_size(&PetLayout {
            width: 160.0,
            height: 160.0,
            mascot_offset_x: -1.0,
            mascot_offset_y: 0.0
        })
        .is_err());
    }
}
