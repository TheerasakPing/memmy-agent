//! Desktop workspace API: never read or overwrite files outside an explicitly
//! chosen folder or the new Tauri Agent-owned workspace. No arbitrary webview FS.
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const MAX_ENTRIES: usize = 500;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const HIDDEN_FOLDERS: &[&str] = &[".git", ".hg", ".svn", ".memmy", "node_modules"];
const AGENT_INTERNALS: &[&str] = &[
    ".memmy-migrations",
    "AGENTS.md",
    "HEARTBEAT.md",
    "SOUL.md",
    "USER.md",
    "cron",
    "memory",
    "sessions",
    "skills",
];

#[derive(Default)]
pub struct WorkspaceGrants(Mutex<HashSet<PathBuf>>);

fn canonical_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("workspace root must be absolute".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "workspace root does not exist")?;
    if canonical.parent().is_none() || !canonical.is_dir() {
        return Err("workspace root must be a non-volume directory".into());
    }
    Ok(canonical)
}

pub fn grant_root(grants: &WorkspaceGrants, selected: &Path) -> Result<(), String> {
    let root = canonical_root(selected)?;
    grants
        .0
        .lock()
        .map_err(|_| "workspace grants unavailable")?
        .insert(root);
    Ok(())
}

fn authorized_root(
    grants: &WorkspaceGrants,
    configured_workspace: &Path,
    path: &Path,
) -> Result<PathBuf, String> {
    let root = canonical_root(path)?;
    // App-owned workspace is always authorized, but legacy Electron paths never are.
    if root == configured_workspace
        || grants
            .0
            .lock()
            .map_err(|_| "workspace grants unavailable")?
            .contains(&root)
    {
        Ok(root)
    } else {
        Err("workspace access requires choosing this folder in the native picker".into())
    }
}

fn path_inside(root: &Path, target: &Path) -> bool {
    target.starts_with(root)
}

fn normalize(relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err("absolute relative path rejected".into());
    }
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("workspace relative path traversal rejected".into());
    }
    Ok(path.to_path_buf())
}

fn checked_directory(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = root.join(normalize(relative)?);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "workspace directory does not exist")?;
    if !path_inside(root, &canonical) || !canonical.is_dir() {
        return Err("workspace directory escapes its root".into());
    }
    Ok(canonical)
}

fn directory_content(
    root: &Path,
    relative: &str,
    agent_root: &Path,
) -> Result<serde_json::Value, String> {
    let directory = checked_directory(root, relative)?;
    let hide_agent = root == agent_root && relative.is_empty();
    let mut entries = Vec::<(String, String, String)>::new();
    for child in fs::read_dir(&directory).map_err(|_| "cannot read workspace directory")? {
        let child = child.map_err(|_| "cannot inspect workspace entry")?;
        let name = child.file_name().to_string_lossy().to_string();
        let target = match child.path().canonicalize() {
            Ok(value) if path_inside(root, &value) => value,
            _ => continue,
        };
        let kind = if target.is_dir() {
            "directory"
        } else if target.is_file() {
            "file"
        } else {
            continue;
        };
        if kind == "directory" && HIDDEN_FOLDERS.contains(&name.as_str())
            || name == ".DS_Store"
            || (hide_agent && AGENT_INTERNALS.contains(&name.as_str()))
        {
            continue;
        }
        let rel = if relative.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", relative.trim_end_matches('/'), name)
        };
        entries.push((
            name,
            target.to_string_lossy().into_owned(),
            format!("{}\u{0000}{}", rel, kind),
        ));
    }
    entries.sort_by(|a, b| {
        let type_a = a.2.split('\0').nth(1).unwrap_or("");
        let type_b = b.2.split('\0').nth(1).unwrap_or("");
        (type_b == "directory")
            .cmp(&(type_a == "directory"))
            .then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase()))
    });
    let truncated = entries.len() > MAX_ENTRIES;
    let entries: Vec<_> = entries
        .into_iter()
        .take(MAX_ENTRIES)
        .map(|(name, path, rel_kind)| {
            let (relative_path, kind) =
                rel_kind.split_once('\0').expect("internal entry delimiter");
            serde_json::json!({ "name": name,"path":path,"relativePath":relative_path,"kind":kind })
        })
        .collect();
    Ok(
        serde_json::json!({ "rootPath":root.to_string_lossy(),"relativePath":relative.replace('\\',"/"),"entries":entries,"truncated":truncated }),
    )
}

fn write_existing_text(
    root: &Path,
    path: &Path,
    contents: &str,
    agent_root: &Path,
) -> Result<(), String> {
    if contents.len() > MAX_TEXT_BYTES {
        return Err("workspace text exceeds 2 MiB".into());
    }
    if !path.is_absolute() {
        return Err("workspace file path must be absolute".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "workspace file does not exist")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("workspace file must be a regular non-symlink file".into());
    }
    let target = path
        .canonicalize()
        .map_err(|_| "workspace file cannot be resolved")?;
    if !path_inside(root, &target) || !target.is_file() {
        return Err("workspace file escapes its root".into());
    }
    let subpath = target
        .strip_prefix(root)
        .map_err(|_| "workspace file escapes its root")?;
    if subpath
        .components()
        .any(|segment| HIDDEN_FOLDERS.contains(&segment.as_os_str().to_string_lossy().as_ref()))
    {
        return Err("protected workspace directory".into());
    }
    if root == agent_root
        && subpath.components().count() == 1
        && AGENT_INTERNALS.contains(&subpath.to_string_lossy().as_ref())
    {
        return Err("protected agent workspace file".into());
    }
    fs::write(target, contents.as_bytes()).map_err(|_| "workspace file write failed".into())
}

fn current_agent_root(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "app data directory unavailable")?;
    // The native bridge can run before the backend startup handshake. Create
    // only this new application's isolated directory, never a legacy profile.
    fs::create_dir_all(&data_dir).map_err(|_| "cannot prepare isolated app workspace")?;
    let workspace = data_dir.join("workspace");
    let agent_data = canonical_root(&data_dir)?;
    if let Ok(meta) = fs::symlink_metadata(&workspace) {
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err("agent workspace cannot be a symbolic link".into());
        }
    }
    fs::create_dir_all(&workspace).map_err(|_| "unable to prepare isolated agent workspace")?;
    let resolved = canonical_root(&workspace)?;
    if !resolved.starts_with(&agent_data) {
        return Err("agent workspace escapes native data directory".into());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn desktop_read_workspace_directory(
    app: AppHandle,
    grants: State<'_, WorkspaceGrants>,
    root_path: String,
    relative_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let agent_root = current_agent_root(&app)?;
    let root = authorized_root(&grants, &agent_root, Path::new(&root_path))?;
    directory_content(&root, relative_path.as_deref().unwrap_or(""), &agent_root)
}

#[tauri::command]
pub fn desktop_write_workspace_file(
    app: AppHandle,
    grants: State<'_, WorkspaceGrants>,
    root_path: String,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    let agent_root = current_agent_root(&app)?;
    let root = authorized_root(&grants, &agent_root, Path::new(&root_path))?;
    write_existing_text(&root, Path::new(&file_path), &contents, &agent_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_read_write_grants_and_path_traversal() {
        let base = std::env::temp_dir().join(format!("memmy-ws-{}", uuid::Uuid::new_v4()));
        let root = base.join("allowed");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("notes.md"), "before").unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "secret").unwrap();
        let grants = WorkspaceGrants::default();
        let canonical = canonical_root(&root).unwrap();
        let nonmatching = base.join("not-approved");
        fs::create_dir(&nonmatching).unwrap();
        assert!(authorized_root(&grants, &nonmatching, &root).is_err());
        grant_root(&grants, &root).unwrap();
        assert_eq!(
            authorized_root(&grants, &nonmatching, &root).unwrap(),
            canonical
        );
        assert!(directory_content(&canonical, "../", &nonmatching).is_err());
        let entries = directory_content(&canonical, "", &nonmatching).unwrap();
        assert_eq!(entries["entries"].as_array().unwrap().len(), 1);
        write_existing_text(&canonical, &root.join("notes.md"), "after", &nonmatching).unwrap();
        assert_eq!(fs::read_to_string(root.join("notes.md")).unwrap(), "after");
        assert!(write_existing_text(
            &canonical,
            &root.join(".git/config"),
            "hijack",
            &nonmatching
        )
        .is_err());
        assert!(write_existing_text(
            &canonical,
            &nonmatching.join("oops"),
            "hijack",
            &nonmatching
        )
        .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("notes.md"), root.join("shortcut")).unwrap();
            assert!(write_existing_text(
                &canonical,
                &root.join("shortcut"),
                "hijack",
                &nonmatching
            )
            .is_err());
        }
        fs::remove_dir_all(base).unwrap();
    }
}
