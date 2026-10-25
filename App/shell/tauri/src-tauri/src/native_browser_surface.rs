//! Read-only browser surface snapshots and tightly scoped user actions from real managed Agent IPC.
//! The child page never gets native commands. The Rust owner transports only validated JSON.
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use url::Url;

pub const EVENT_PREFIX: &str = "MEMMY_TAURI_BROWSER_SURFACE ";
pub const ACTION_PREFIX: &str = "MEMMY_TAURI_BROWSER_ACTION ";
const MAX_EVENT_BYTES: usize = 3_200_000;
const MAX_ACTION_BYTES: usize = 4_500;
const MAX_SESSIONS: usize = 32;

#[derive(Clone, Default)]
pub struct BrowserSurfaceStore(Arc<Mutex<HashMap<String, Value>>>);

fn valid_identity(value: &Value) -> bool {
    ["sessionKey", "channel", "chatId", "targetId", "title"]
        .iter()
        .all(|key| {
            value
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.is_empty() && s.len() <= 256)
        })
}

fn valid_surface(value: &Value) -> bool {
    value.get("surface").and_then(Value::as_str) == Some("browser")
        && matches!(
            value.get("type").and_then(Value::as_str),
            Some("memmy:computer-use-surface:update" | "memmy:computer-use-surface:close")
        )
        && valid_identity(value)
        && value.get("imageDataUrl").is_none_or(|img| {
            img.as_str().is_some_and(|s| {
                s.len() <= 3_000_000
                    && (s.starts_with("data:image/png;base64,")
                        || s.starts_with("data:image/jpeg;base64,")
                        || s.starts_with("data:image/webp;base64,"))
            })
        })
        && value
            .get("url")
            .is_none_or(|u| u.as_str().is_some_and(|s| s.len() <= 4096))
        && value
            .get("presentationOnly")
            .is_none_or(|v| v == true && value["type"] == "memmy:computer-use-surface:close")
        && ["canGoBack", "canGoForward"]
            .iter()
            .all(|field| value.get(*field).is_none_or(Value::is_boolean))
        && value
            .get("error")
            .is_none_or(|error| error.as_str().is_some_and(|text| text.len() <= 256))
        && value.get("appKey").is_none_or(|app_key| {
            app_key.as_str().is_some_and(|text| {
                !text.is_empty() && text.len() <= 256 && !text.chars().any(char::is_control)
            })
        })
        && value.as_object().is_some_and(|obj| {
            obj.keys().all(|name| {
                [
                    "type",
                    "surface",
                    "sessionKey",
                    "channel",
                    "chatId",
                    "targetId",
                    "title",
                    "imageDataUrl",
                    "url",
                    "canGoBack",
                    "canGoForward",
                    "error",
                    "presentationOnly",
                    "appKey",
                ]
                .contains(&name.as_str())
            })
        })
}

impl BrowserSurfaceStore {
    pub fn update(&self, raw: &str) -> Option<Value> {
        if raw.len() > MAX_EVENT_BYTES {
            return None;
        }
        let incoming: Value = serde_json::from_str(raw).ok()?;
        if !valid_surface(&incoming) {
            return None;
        }
        let key = incoming["sessionKey"].as_str()?.to_string();
        let mut current = self.0.lock().ok()?;
        if let Some(previous) = current.get(&key) {
            if ["channel", "chatId", "targetId"]
                .iter()
                .any(|field| previous[field] != incoming[*field])
            {
                return None;
            }
        }
        if incoming["type"] == "memmy:computer-use-surface:close" {
            if incoming["presentationOnly"] != true {
                current.remove(&key);
            }
        } else {
            if !current.contains_key(&key) && current.len() >= MAX_SESSIONS {
                return None;
            }
            current.insert(key, incoming.clone());
        }
        Some(incoming)
    }
    pub fn get(&self, session_key: &str) -> Option<Value> {
        if session_key.is_empty() || session_key.len() > 256 {
            return None;
        }
        self.0.lock().ok()?.get(session_key).cloned()
    }
    pub fn clear(&self) -> Vec<Value> {
        let Ok(mut state) = self.0.lock() else {
            return vec![];
        };
        let old = state
            .values()
            .map(|v| {
                let mut ended = v.clone();
                ended["type"] = json!("memmy:computer-use-surface:close");
                ended.as_object_mut().map(|o| o.remove("imageDataUrl"));
                ended
            })
            .collect();
        state.clear();
        old
    }
    /// Only allow actions on a current Agent-authored surface; client never supplies its identity.
    pub fn action_line(&self, session_key: &str, input: &Value) -> Option<String> {
        let identity = self.get(session_key)?;
        let input = input.as_object()?;
        if input
            .keys()
            .any(|k| !["action", "x", "y", "deltaY", "key", "url"].contains(&k.as_str()))
        {
            return None;
        }
        let action = input.get("action")?.as_str()?;
        let normalized = |key| {
            input
                .get(key)
                .and_then(Value::as_f64)
                .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
        };
        let only = |allowed: &[&str]| input.keys().all(|key| allowed.contains(&key.as_str()));
        let valid = match action {
            "click" => normalized("x") && normalized("y") && only(&["action", "x", "y"]),
            "scroll" => {
                input
                    .get("deltaY")
                    .and_then(Value::as_f64)
                    .is_some_and(|v| v.is_finite() && v.abs() <= 1000.0)
                    && (!input.contains_key("x") && !input.contains_key("y")
                        || normalized("x") && normalized("y"))
                    && only(&["action", "deltaY", "x", "y"])
            }
            "key" => {
                input
                    .get("key")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty() && s.len() <= 64)
                    && only(&["action", "key"])
            }
            "navigate" => {
                input.get("url").and_then(Value::as_str).is_some_and(|raw| {
                    raw.len() <= 4096
                        && Url::parse(raw).ok().is_some_and(|url| {
                            matches!(url.scheme(), "http" | "https")
                                && url.host_str().is_some()
                                && url.username().is_empty()
                                && url.password().is_none()
                        })
                }) && only(&["action", "url"])
            }
            "open" | "back" | "forward" | "reload" => only(&["action"]),
            _ => false,
        };
        if !valid {
            return None;
        }
        let mut message = Map::new();
        for key in ["sessionKey", "channel", "chatId", "targetId"] {
            message.insert(key.to_string(), identity[key].clone());
        }
        message.insert("type".into(), json!("memmy:computer-use-surface:action"));
        message.insert("surface".into(), json!("browser"));
        for (key, value) in input {
            message.insert(key.clone(), value.clone());
        }
        let serialized = format!("{ACTION_PREFIX}{}\n", Value::Object(message));
        (serialized.len() <= MAX_ACTION_BYTES).then_some(serialized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot(session: &str) -> String {
        json!({"type":"memmy:computer-use-surface:update","surface":"browser",
          "sessionKey":session,"channel":"websocket","chatId":"chat-1","targetId":"active-tab",
          "title":"Agent Browser","url":"https://example.org","imageDataUrl":"data:image/png;base64,aGVsbG8="}).to_string()
    }
    #[test]
    fn rejects_forged_surfaces_and_unowned_actions() {
        let store = BrowserSurfaceStore::default();
        assert!(store
            .action_line("never", &json!({"action":"open"}))
            .is_none());
        assert!(store.update(&snapshot("session-1")).is_some());
        assert!(store.get("session-1").is_some());
        let forged = json!({"type":"memmy:computer-use-surface:update","surface":"browser",
          "sessionKey":"session-1","channel":"websocket","chatId":"other-chat",
          "targetId":"active-tab","title":"Attacker"})
        .to_string();
        assert!(store.update(&forged).is_none());
        assert_eq!(store.get("session-1").unwrap()["chatId"], "chat-1");
        assert!(store
            .action_line("session-2", &json!({"action":"click","x":0.2,"y":0.3}))
            .is_none());
        assert!(store
            .update(&snapshot("session-2").replace("\"browser\"", "\"computer\""))
            .is_none());
        assert!(store
            .update(&json!({"surface":"browser","sessionKey":"forged"}).to_string())
            .is_none());
        assert!(store
            .action_line("session-1", &json!({"action":"click","x":2.0,"y":0.3}))
            .is_none());
        assert!(store
            .action_line(
                "session-1",
                &json!({"action":"navigate","url":"file:///etc/passwd"})
            )
            .is_none());
        assert!(store
            .action_line(
                "session-1",
                &json!({"action":"navigate","url":"https://a:b@example.com"})
            )
            .is_none());
        assert!(store
            .action_line("session-1", &json!({"action":"open","command":"eval"}))
            .is_none());
        let line = store
            .action_line("session-1", &json!({"action":"click","x":0.2,"y":0.3}))
            .unwrap();
        assert!(line.contains("\"chatId\":\"chat-1\""));
        assert!(line.contains("\"targetId\":\"active-tab\""));
        assert_eq!(store.clear().len(), 1);
        assert!(store.get("session-1").is_none());
    }
    #[test]
    fn closing_agent_surface_revokes_old_session() {
        let store = BrowserSurfaceStore::default();
        store.update(&snapshot("s")).unwrap();
        let closed = json!({"type":"memmy:computer-use-surface:close","surface":"browser",
          "sessionKey":"s","channel":"websocket","chatId":"chat-1","targetId":"active-tab",
          "title":"Agent Browser"})
        .to_string();
        assert!(store.update(&closed).is_some());
        assert!(store
            .action_line("s", &json!({"action":"reload"}))
            .is_none());
    }
}
