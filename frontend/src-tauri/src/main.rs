// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindow,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

mod lan;

/// Opens http(s)/mailto links in the system browser instead of navigating the
/// webview. Injected before any page script runs.
const LINK_INTERCEPT_SCRIPT: &str = r#"
(function () {
  const openExternal = function (url) {
    try {
      window.__TAURI__.opener.openUrl(url);
    } catch (e) {
      console.error("failed to open external url", url, e);
    }
  };

  const isExternal = function (url) {
    return typeof url === "string" && /^(https?|mailto):/i.test(url);
  };

  const originalOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    if (isExternal(url)) {
      openExternal(url);
      return null;
    }
    return originalOpen(url, target, features);
  };

  document.addEventListener(
    "click",
    function (event) {
      const target = event.target;
      if (!target || typeof target.closest !== "function") return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (isExternal(href)) {
        event.preventDefault();
        openExternal(href);
      }
    },
    true
  );
})();
"#;

/// Shows the main window - or hides it when it is visible AND focused (the
/// tray/hotkey toggle behaviour). A visible-but-unfocused window is summoned
/// to the front, never hidden: the hotkey's main use case is calling the app
/// up while working elsewhere (audit Y3).
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let minimized = window.is_minimized().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && !minimized && focused {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// Update checking. ENABLED as of 0.28.0: both switches are on — this flag
/// AND `plugins.updater.endpoints` in tauri.conf.json (the live GitHub
/// Releases endpoint, commit 59ae826). The pairing contract still holds:
/// never move one without the other (flag on + placeholder endpoint fires
/// doomed requests; endpoint set + flag off silently never updates).
const UPDATES_ENABLED: bool = true;
/// phase 56: the updater toggle persists here (the app config dir)
const UPDATES_SETTINGS_FILE: &str = "updates-settings.json";

/// Checks the update endpoint once at startup. Non-fatal: any failure
/// (offline, unreachable host, bad json) is logged and ignored.
fn check_for_updates(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match app.updater().expect("updater plugin").check().await {
            Ok(Some(update)) => {
                println!(
                    "update available: {} -> {}",
                    update.current_version, update.version
                );
                //internal build policy: download and run the installer
                //passively; a failure must not take the app down
                if let Err(e) = update
                    .download_and_install(|_chunk, _total| {}, || {})
                    .await
                {
                    eprintln!("update install failed: {e}");
                } else {
                    println!("update installed - restarting");
                    app.restart();
                }
            }
            Ok(_) => println!("no update available"),
            Err(e) => eprintln!("update check failed: {e}"),
        }
    });
}

fn updates_settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(UPDATES_SETTINGS_FILE))
        .map_err(|e| e.to_string())
}

/// phase 56: the updater's user-facing switch, persisted in the app
/// CONFIG dir. Missing or corrupt file = ON — the safe default.
fn load_auto_check(path: &std::path::Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value["autoCheck"].as_bool())
        .unwrap_or(true)
}

fn save_auto_check(path: &std::path::Path, enabled: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("updates: mkdir failed ({e})"))?;
    }
    std::fs::write(
        path,
        serde_json::json!({ "autoCheck": enabled }).to_string(),
    )
    .map_err(|e| format!("updates: write failed ({e})"))
}

/// phase 56: the manual "check for updates". Resolves "current" for a
/// green answer; when an update exists it downloads and installs
/// passively and the app restarts — the invoke response may never reach
/// the frontend, so the UI announces each step through the
/// `updates://status` events
#[tauri::command]
async fn updater_manual_check(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let update = app
        .updater()
        .map_err(|e| format!("updates: plugin unavailable ({e})"))?
        .check()
        .await
        .map_err(|e| format!("updates: check failed ({e})"))?;
    match update {
        Some(update) => {
            let version = update.version.clone();
            app.emit(
                "updates://status",
                serde_json::json!({ "status": "available", "version": version }),
            );
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| format!("updates: install failed ({e})"))?;
            app.emit(
                "updates://status",
                serde_json::json!({ "status": "installed", "version": version }),
            );
            let restart_app = app.clone();
            tauri::async_runtime::spawn(async move {
                restart_app.restart();
            });
            Ok(serde_json::json!({ "status": "updated", "version": version }))
        }
        None => Ok(serde_json::json!({ "status": "current" })),
    }
}

#[tauri::command]
fn updater_get_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = updates_settings_path(&app)?;
    Ok(serde_json::json!({ "autoCheck": load_auto_check(&path) }))
}

#[tauri::command]
fn updater_set_auto_check(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = updates_settings_path(&app)?;
    save_auto_check(&path, enabled)
}

/// Phase 71: the user's own text library — `.txt` files dropped into the
/// app CONFIG dir's `texts/` folder become typable through the custom-text
/// modal. The folder is created on demand so there is always an obvious
/// place to drop files.
const USER_TEXTS_DIR: &str = "texts";
/// a single text file larger than this is refused — typing material, not
/// a data dump
const USER_TEXT_MAX_BYTES: u64 = 1024 * 1024;

fn texts_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join(USER_TEXTS_DIR))
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// no separators, no dot-dot, no leading dot — the name may only ever be
/// joined onto the texts dir itself
fn sanitize_text_name(name: &str) -> Result<String, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err("invalid text file name".to_string());
    }
    Ok(name.to_string())
}

#[derive(serde::Serialize)]
struct UserTextFile {
    name: String,
    size: u64,
}

#[tauri::command]
fn texts_folder_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = texts_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn texts_list(app: tauri::AppHandle) -> Result<Vec<UserTextFile>, String> {
    let dir = texts_dir(&app)?;
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("read texts dir: {e}"))?;
    let mut files: Vec<UserTextFile> = Vec::new();
    for entry in entries.flatten() {
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if !metadata.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".txt") {
            continue;
        }
        files.push(UserTextFile {
            name,
            size: metadata.len(),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
fn texts_read(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let clean = sanitize_text_name(&name)?;
    let dir = texts_dir(&app)?;
    let path = dir.join(&clean);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("stat: {e}"))?;
    if metadata.len() > USER_TEXT_MAX_BYTES {
        return Err("file too large (1MB limit for typing texts)".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))
}

/// Phase 84: the LAN leaderboard — the HOST persists the guests' results
/// (the room relay delivers them; this store makes them OUTLIVE the
/// session). A JSON file in the app DATA dir, capped at 500 rows (the
/// oldest fall off).
const LEADERBOARD_FILE: &str = "lan-leaderboard.json";
const LEADERBOARD_CAP: usize = 500;

fn leaderboard_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(LEADERBOARD_FILE))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn lan_leaderboard_write(
    app: tauri::AppHandle,
    entry: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !entry.is_object() {
        return Err("lan: the leaderboard entry must be an object".into());
    }
    let path = leaderboard_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut entries: Vec<serde_json::Value> = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    entries.push(entry);
    if entries.len() > LEADERBOARD_CAP {
        let overflow = entries.len() - LEADERBOARD_CAP;
        entries.drain(0..overflow);
    }
    let out = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    //truncate-then-write mirrors the backup path (audit Y2)
    let tmp = path.with_file_name(format!("{LEADERBOARD_FILE}.tmp"));
    std::fs::write(&tmp, out).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "stored": true }))
}

#[tauri::command]
fn lan_leaderboard_read(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = leaderboard_path(&app)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) => return Ok(Vec::new()),
    };
    let entries: Vec<serde_json::Value> =
        serde_json::from_str(&text).map_err(|e| format!("corrupt leaderboard: {e}"))?;
    Ok(entries)
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle =
        MenuItem::with_id(app, "toggle", "Show/Hide ParallelType", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("ParallelType")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Registers the global show/hide shortcut, falling back to the next combo
/// when the first is taken by another app. Failure to register any shortcut
/// is non-fatal: the tray keeps working.
fn register_global_shortcut(app: &tauri::AppHandle) {
    for combo in ["ctrl+shift+m", "ctrl+alt+m"] {
        let result = app.global_shortcut().on_shortcut(combo, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_main_window(app);
            }
        });
        match result {
            Ok(_) => {
                println!("global shortcut registered: {combo}");
                return;
            }
            Err(e) => eprintln!("failed to register {combo}: {e}"),
        }
    }
    eprintln!("no global shortcut registered - tray menu still works");
}

/// Name of the automatic backup file inside the app data dir. The app data
/// dir sits outside the WebView2 profile, so the backup survives a wiped or
/// migrated webview profile (KI-02).
const BACKUP_FILE: &str = "backup.json";

/// App identifier before the rebrand. Backups stored under it stay readable
/// so an identifier change or a fresh webview profile never strands data.
const LEGACY_IDENTIFIER: &str = "com.monkeytype.desktop";

fn backup_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(BACKUP_FILE))
        .map_err(|e| e.to_string())
}

fn legacy_backup_file_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let current_dir = app.path().app_data_dir().ok()?;
    //app_data_dir = <config dir>/<identifier>; look under the previous one
    let legacy_dir = current_dir.parent()?.join(LEGACY_IDENTIFIER);
    Some(legacy_dir.join(BACKUP_FILE))
}

/// Writes the backup file atomically: the payload goes to `<name>.tmp` first
/// and is then renamed over the target (an atomic same-volume operation), so
/// a crash or power loss mid-write can never leave a truncated backup behind
/// (audit Y2). Any failure leaves the previous file untouched.
fn write_backup_file_atomic(path: &std::path::Path, contents: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "backup path has no file name".to_string())?;
    let tmp = path.with_file_name(format!("{file_name}.tmp"));
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        //best-effort cleanup so a failed rename doesn't leave litter behind
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Writes the automatic backup file (whole JSON payload from the frontend).
#[tauri::command]
fn backup_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = backup_file_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_backup_file_atomic(&path, &contents)
}

/// Reads the automatic backup file, if one exists. Falls back to the backup
/// written under the previous identifier; a missing file is not an error.
#[tauri::command]
fn backup_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    if let Ok(contents) = std::fs::read_to_string(backup_file_path(&app)?) {
        return Ok(Some(contents));
    }
    if let Some(legacy) = legacy_backup_file_path(&app) {
        if let Ok(contents) = std::fs::read_to_string(legacy) {
            return Ok(Some(contents));
        }
    }
    Ok(None)
}

fn main() {
    tauri::Builder::default()
        //must be the FIRST plugin: a second launch forwards here instead of
        //starting a duplicate process — close-to-tray would make that
        //duplicate an invisible window the user cannot see
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            backup_write,
            backup_read,
            updater_get_settings,
            updater_set_auto_check,
            updater_manual_check,
            texts_folder_path,
            texts_list,
            texts_read,
            lan::lan_send_to_client,
            lan_leaderboard_write,
            lan_leaderboard_read,
            lan::lan_start_host,
            lan::lan_stop_host,
            lan::lan_send_message,
            lan::lan_connect_client,
            lan::lan_client_send,
            lan::lan_disconnect_client,
            lan::lan_start_discovery,
            lan::lan_stop_discovery,
            lan::lan_get_discovered
        ])
        .manage(lan::LanState {
            host: Mutex::new(None),
            client: Mutex::new(None),
            discovered: Mutex::new(HashMap::new()),
            discovery: Mutex::new(None),
        })
        .setup(|app| {
            let window: WebviewWindow =
                tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                    .title("ParallelType")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(700.0, 500.0)
                    .initialization_script(LINK_INTERCEPT_SCRIPT)
                    .build()?;
            let _ = window; //window is retained by the app

            //a missing tray backend (libayatana-appindicator on some Linux
            //setups) must not take the whole app down
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                build_tray(app.handle())
            })) {
                Ok(Ok(())) => {}
                Ok(Err(e)) => eprintln!("tray init failed: {e}"),
                Err(p) => eprintln!("tray init panicked: {p:?}"),
            }

            register_global_shortcut(app.handle());
            focus_main_window(app.handle());
            if UPDATES_ENABLED {
                let path = updates_settings_path(app.handle())
                    .unwrap_or_else(|_| std::path::PathBuf::new());
                if load_auto_check(&path) {
                    check_for_updates(app.handle());
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            //closing the window hides it to the tray; Quit lives in the tray menu
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("paralleltype_atomic_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn atomic_write_replaces_the_file_and_leaves_no_tmp() {
        let dir = temp_dir("success");
        let target = dir.join("backup.json");
        std::fs::write(&target, "old").expect("seed old file");

        write_backup_file_atomic(&target, "new").expect("atomic write");

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
        assert!(!dir.join("backup.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_failure_keeps_the_previous_file() {
        let dir = temp_dir("failure");
        let target = dir.join("backup.json");
        std::fs::write(&target, "old").expect("seed old file");
        //make the tmp path unusable: a DIRECTORY sits at the tmp location,
        //so the tmp write fails exactly like a crash mid-write would
        std::fs::create_dir_all(dir.join("backup.json.tmp")).expect("block tmp");

        assert!(write_backup_file_atomic(&target, "new").is_err());

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
