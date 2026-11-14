import { createSignal } from "solid-js";
import { z } from "zod";

import { LocalStorageWithSchema } from "./local-storage-with-schema";

/**
 * phase 99: streamer mode — one switch for a stream-friendly test surface.
 * ON: the app shell gains the `streamer-mode` body class (styles/core.scss
 * then hides the header/footer chrome and scales the typing words up), so
 * an OBS window capture of the test page shows ONLY the typing. the store
 * is the independent-store house rule (mtDesktopStreamerMode) and the
 * body class re-applies from it at boot.
 */

const streamerStore = new LocalStorageWithSchema({
  key: "mtDesktopStreamerMode",
  schema: z.boolean(),
  fallback: false,
});

const [streamerMode, setStreamerModeSignal] = createSignal<boolean>(
  streamerStore.get(),
);

function applyBodyClass(enabled: boolean): void {
  document.body.classList.toggle("streamer-mode", enabled);
}

export function streamerModeEnabled(): boolean {
  return streamerMode();
}

export function setStreamerModeEnabled(enabled: boolean): void {
  streamerStore.set(enabled);
  setStreamerModeSignal(enabled);
  applyBodyClass(enabled);
}

/** re-applies the body class from the persisted state (the boot entry) */
export function applyStreamerModeAtBoot(): void {
  applyBodyClass(streamerMode());
}

/** the specs' reset (prod never calls it) */
export function resetStreamerMode(): void {
  streamerStore.clear();
  setStreamerModeSignal(streamerStore.get());
  applyBodyClass(false);
}
