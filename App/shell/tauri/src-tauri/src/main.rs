#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Headless package acceptance check. Never touches the actual user's data,
    // and validates startup/shutdown using the same bundled runtime as Finder.
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--smoke-native-runtime"))
    {
        std::process::exit(memmy_turbo_tauri_lib::smoke_installed_runtime());
    }
    memmy_turbo_tauri_lib::run();
}
