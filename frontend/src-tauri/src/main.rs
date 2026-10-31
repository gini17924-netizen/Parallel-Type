// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindow,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

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

/// Shows the main window, or hides it when it is visible and focused
/// (the tray/hotkey toggle behaviour).
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let minimized = window.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

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

/// Writes the automatic backup file (whole JSON payload from the frontend).
#[tauri::command]
fn backup_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = backup_file_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![backup_write, backup_read])
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
            check_for_updates(app.handle());
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
