/*
 * The desktop updater's frontend accessor (phase 56): the persisted
 * auto-check toggle + the manual check command. The boot check runs
 * BEFORE this module loads, so the auto flag lives in a file the Rust
 * side reads from the app CONFIG dir — these commands just flip it and
 * drive the manual check. Browser/webview-preview builds resolve to
 * undefined (the caller renders the desktop-only note).
 */

type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

function getInvoke(): TauriInvoke | undefined {
  const tauri = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: TauriInvoke } };
    }
  ).__TAURI__;
  return tauri?.core?.invoke;
}

export type UpdatesSettings = {
  /** whether the boot check for updates is enabled (default: on) */
  autoCheck: boolean;
};

export type UpdateCheckResult =
  | { status: "current" }
  | { status: "updated"; version: string };

export async function updatesGetSettings(): Promise<
  UpdatesSettings | undefined
> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  try {
    return (await invoke("updates_get_settings")) as UpdatesSettings;
  } catch (error) {
    console.error("updates: settings read failed", error);
    return undefined;
  }
}

export async function updatesSetAutoCheck(enabled: boolean): Promise<void> {
  const invoke = getInvoke();
  if (invoke === undefined) return;
  try {
    await invoke("updates_set_auto_check", { enabled });
  } catch (error) {
    console.error("updates: auto-check flip failed", error);
  }
}

/** resolves "current" for a green answer; when an update exists the rust
 * side installs it and restarts — the promise may never settle (the UI
 * keeps the "installing, restarting…" line it set before calling) */
export async function updatesCheckNow(): Promise<
  UpdateCheckResult | undefined
> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  try {
    return (await invoke("updates_check_now")) as UpdateCheckResult;
  } catch (error) {
    console.error("updates: check failed", error);
    return undefined;
  }
}
