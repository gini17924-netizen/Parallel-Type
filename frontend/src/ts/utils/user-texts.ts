/*
 * The user text library's frontend accessor (phase 71): `.txt` files in
 * the app config dir's `texts/` folder, listed and read through the
 * texts_* commands. The folder listing is cached module-level (a modal
 * open must not re-scan the disk); the last-picked file persists in its
 * own store so the library remembers where the user left off.
 * Browser/webview-preview builds resolve to undefined (the modal hides
 * the section).
 */
import { z } from "zod";

import { LocalStorageWithSchema } from "./local-storage-with-schema";

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

/** false in the browser/webview-preview build (the modal hides the section) */
export function isUserTextsAvailable(): boolean {
  return getInvoke() !== undefined;
}

export type UserTextFile = {
  name: string;
  size: number;
};

/** module-level listing cache; invalidated by the modal's refresh */
let listCache: UserTextFile[] | undefined;

export async function userTextsList(force = false): Promise<
  UserTextFile[] | undefined
> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  if (listCache !== undefined && !force) return listCache;
  try {
    const list = (await invoke("texts_list")) as UserTextFile[];
    listCache = list;
    return list;
  } catch (error) {
    console.error("user texts: list failed", error);
    return undefined;
  }
}

export function invalidateUserTextsCache(): void {
  listCache = undefined;
}

export async function userTextsRead(name: string): Promise<string | undefined> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  try {
    return (await invoke("texts_read", { name })) as string;
  } catch (error) {
    console.error("user texts: read failed", error);
    return undefined;
  }
}

export async function userTextsFolderPath(): Promise<string | undefined> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  try {
    return (await invoke("texts_folder_path")) as string;
  } catch (error) {
    console.error("user texts: folder path failed", error);
    return undefined;
  }
}

const lastPickedStore = new LocalStorageWithSchema({
  key: "mtDesktopUserTexts",
  schema: z.object({
    lastPickedFile: z.string().optional(),
  }),
  fallback: {},
});

export function getLastPickedFile(): string | undefined {
  return lastPickedStore.get().lastPickedFile;
}

export function setLastPickedFile(name: string): void {
  lastPickedStore.set({ lastPickedFile: name });
}
