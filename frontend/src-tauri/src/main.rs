// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::WebviewUrl;

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("/".into()),
            )
            .title("Monkeytype")
            .inner_size(1280.0, 800.0)
            .min_inner_size(700.0, 500.0)
            .initialization_script(LINK_INTERCEPT_SCRIPT)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
