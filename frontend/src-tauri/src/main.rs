// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindow,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

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

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle =
        MenuItem::with_id(app, "toggle", "Show/Hide Monkeytype", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Monkeytype")
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let window: WebviewWindow =
                tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                    .title("Monkeytype")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(700.0, 500.0)
                    .initialization_script(LINK_INTERCEPT_SCRIPT)
                    .build()?;
            let _ = window; //window is retained by the app

            build_tray(app.handle())?;
            register_global_shortcut(app.handle());
            focus_main_window(app.handle());
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
