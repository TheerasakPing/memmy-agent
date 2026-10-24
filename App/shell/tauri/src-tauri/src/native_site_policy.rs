//! Tauri-owned browser-use site policies, stored in the Agent Gateway's
//! actual data directory. The Agent reads the same version-1 document.
//! This is only a policy-store migration, NOT an embedded browser driver.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};

use crate::native_browser_store::{atomic_json, browser_folder, check_data_file};

const POLICY_BYTES: u64 = 128 * 1024;
const POLICY_LIMIT: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteRule {
    pattern: String,
    access: String,
    downloads: String,
    uploads: String,
    full_cdp: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SiteDocument {
    version: u8,
    rules: Vec<SiteRule>,
}

fn canonical_pattern(raw: &str) -> Result<String, String> {
    if raw.len() > 320
        || !raw.starts_with("http://") && !raw.starts_with("https://")
        || raw.trim() != raw
        || raw.chars().any(char::is_whitespace)
    {
        return Err("invalid browser site protocol or pattern length".into());
    }
    let (scheme, authority) = raw
        .split_once("://")
        .ok_or("invalid browser site pattern")?;
    if authority.is_empty() || authority.contains(['/', '?', '#', '@', '\\']) {
        return Err("site policies must target origins, never paths or credentials".into());
    }
    let (prefix, without_wildcard) = if let Some(rest) = authority.strip_prefix("**.") {
        ("**.", rest)
    } else if let Some(rest) = authority.strip_prefix("*.") {
        ("*.", rest)
    } else {
        ("", authority)
    };
    if without_wildcard.contains('*')
        || without_wildcard.contains('%')
        || without_wildcard.contains(['[', ']'])
    {
        return Err("invalid site host wildcard".into());
    }
    let parsed = url::Url::parse(&format!("{scheme}://{without_wildcard}"))
        .map_err(|_| "invalid site host or port")?;
    let host = parsed.host_str().ok_or("site host missing")?;
    if host.is_empty()
        || host.starts_with('.')
        || host.split('.').any(str::is_empty)
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("invalid site origin".into());
    }
    if prefix != "" && !host.contains('.') {
        return Err("wildcard requires a qualified host".into());
    }
    Ok(format!(
        "{scheme}://{prefix}{host}{}",
        parsed
            .port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default()
    ))
}

fn valid_rule(rule: &SiteRule) -> Result<String, String> {
    for decision in [&rule.access, &rule.downloads, &rule.uploads, &rule.full_cdp] {
        if !matches!(decision.as_str(), "allow" | "ask" | "block") {
            return Err("invalid browser capability decision".into());
        }
    }
    canonical_pattern(&rule.pattern)
}

fn load_policies(path: &Path) -> Result<Vec<SiteRule>, String> {
    if !check_data_file(path, POLICY_BYTES)? {
        return Ok(Vec::new());
    }
    let raw = fs::read(path).map_err(|_| "site policy file unavailable")?;
    let doc: SiteDocument =
        serde_json::from_slice(&raw).map_err(|_| "corrupt browser site policy")?;
    if doc.version != 1 || doc.rules.len() > POLICY_LIMIT {
        return Err("invalid policy version or capacity".into());
    }
    let mut seen = HashSet::new();
    for rule in &doc.rules {
        let canonical = valid_rule(rule)?;
        if !seen.insert(canonical) {
            return Err("duplicate browser site policies".into());
        }
    }
    Ok(doc.rules)
}

fn save_policies(path: &Path, rules: Vec<SiteRule>) -> Result<Vec<SiteRule>, String> {
    if rules.len() > POLICY_LIMIT {
        return Err("browser site policy limit exceeded".into());
    }
    let mut seen = HashSet::new();
    for rule in &rules {
        let normalized = valid_rule(rule)?;
        if !seen.insert(normalized) {
            return Err("duplicate site policy".into());
        }
    }
    atomic_json(
        path,
        &SiteDocument {
            version: 1,
            rules: rules.clone(),
        },
        POLICY_BYTES,
    )?;
    Ok(rules)
}

fn upsert_policy(path: &Path, mut rule: SiteRule) -> Result<Vec<SiteRule>, String> {
    let canonical = valid_rule(&rule)?;
    rule.pattern = canonical.clone();
    let mut rules = load_policies(path)?;
    if let Some(index) = rules
        .iter()
        .position(|item| canonical_pattern(&item.pattern).is_ok_and(|pattern| pattern == canonical))
    {
        rules[index] = rule;
    } else {
        rules.push(rule);
    }
    save_policies(path, rules)
}

fn remove_policy(path: &Path, raw_pattern: &str) -> Result<Vec<SiteRule>, String> {
    let canonical = canonical_pattern(raw_pattern)?;
    let mut rules = load_policies(path)?;
    rules.retain(|item| canonical_pattern(&item.pattern).is_ok_and(|pattern| pattern != canonical));
    save_policies(path, rules)
}

fn policy_file(app: &AppHandle, window: &WebviewWindow) -> Result<PathBuf, String> {
    if window.label() != "main" {
        return Err("site permissions require main window".into());
    }
    Ok(browser_folder(app)?.join("site-policy.json"))
}

#[tauri::command]
pub fn desktop_get_browser_use_site_policies(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<SiteRule>, String> {
    load_policies(&policy_file(&app, &window)?)
}

#[tauri::command]
pub fn desktop_upsert_browser_use_site_policy(
    app: AppHandle,
    window: WebviewWindow,
    rule: SiteRule,
) -> Result<Vec<SiteRule>, String> {
    upsert_policy(&policy_file(&app, &window)?, rule)
}

#[tauri::command]
pub fn desktop_remove_browser_use_site_policy(
    app: AppHandle,
    window: WebviewWindow,
    pattern: String,
) -> Result<Vec<SiteRule>, String> {
    remove_policy(&policy_file(&app, &window)?, &pattern)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example(pattern: &str) -> SiteRule {
        SiteRule {
            pattern: pattern.into(),
            access: "ask".into(),
            downloads: "block".into(),
            uploads: "ask".into(),
            full_cdp: "block".into(),
        }
    }
    fn path() -> PathBuf {
        std::env::temp_dir()
            .join(format!("memmy-native-site-{}", uuid::Uuid::new_v4()))
            .join("browser-use")
            .join("site-policy.json")
    }
    #[test]
    fn accepts_only_origin_scoped_rules_and_rejects_explicit_elevation() {
        for invalid in [
            "file:///etc/passwd",
            "javascript:prompt(1)",
            "https://host.example/a",
            "https://user@host.example",
            "https://host.example?x=1",
            "https://*.com/foo",
            "https://**evil.com",
            "https://bad*.example",
            "https://x.example/%2e%2e",
            "http://x.example#anchor",
        ] {
            assert!(
                canonical_pattern(invalid).is_err(),
                "accepted unsafe pattern {invalid}"
            );
        }
        assert_eq!(
            canonical_pattern("https://EXAMPLE.com:443").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            canonical_pattern("https://*.Example.com").unwrap(),
            "https://*.example.com"
        );
        assert_eq!(
            canonical_pattern("https://**.Example.com:8443").unwrap(),
            "https://**.example.com:8443"
        );
        let mut rule = example("https://example.com");
        rule.full_cdp = "everything".into();
        assert!(valid_rule(&rule).is_err());
    }
    #[test]
    fn persists_and_updates_agent_compatible_v1_policy_document() {
        let file = path();
        assert!(load_policies(&file).unwrap().is_empty());
        let rules = upsert_policy(&file, example("https://EXAMPLE.com")).unwrap();
        assert_eq!(rules[0].pattern, "https://example.com");
        assert_eq!(rules[0].downloads, "block");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&file).unwrap()).unwrap()
                ["version"],
            1
        );
        let mut updated = example("https://example.com");
        updated.downloads = "allow".into();
        assert_eq!(upsert_policy(&file, updated).unwrap().len(), 1);
        assert_eq!(load_policies(&file).unwrap()[0].downloads, "allow");
        assert!(remove_policy(&file, "https://example.com")
            .unwrap()
            .is_empty());
        assert!(load_policies(&file).unwrap().is_empty());
        fs::remove_dir_all(file.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test]
    fn forged_symlinks_and_corrupt_or_duplicate_stored_policies_fail_closed() {
        let file = path();
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, b"{\"version\":1,\"rules\":[{\"pattern\":\"javascript:evil\",\"access\":\"allow\",\"downloads\":\"allow\",\"uploads\":\"allow\",\"fullCdp\":\"allow\"}]}").unwrap();
        assert!(load_policies(&file).is_err());
        let rule = example("https://example.com");
        fs::write(
            &file,
            serde_json::to_vec(&SiteDocument {
                version: 1,
                rules: vec![rule.clone(), rule],
            })
            .unwrap(),
        )
        .unwrap();
        assert!(load_policies(&file).is_err());
        #[cfg(unix)]
        {
            fs::remove_file(&file).unwrap();
            std::os::unix::fs::symlink("/etc/hosts", &file).unwrap();
            assert!(load_policies(&file).is_err());
            assert!(upsert_policy(&file, example("https://example.com")).is_err());
        }
        fs::remove_dir_all(file.parent().unwrap().parent().unwrap()).unwrap();
    }
}
