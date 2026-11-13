import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLastPickedFile,
  invalidateUserTextsCache,
  isUserTextsAvailable,
  setLastPickedFile,
  userTextsList,
  userTextsRead,
} from "../../src/ts/utils/user-texts";

type InvokeMock = (cmd: string, args?: Record<string, unknown>) => unknown;

function installInvokeMock(impl: InvokeMock): { calls: { cmd: string; args?: Record<string, unknown> }[] } {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return impl(cmd, args);
      },
    },
  };
  return { calls };
}

describe("phase 71 — the user text library accessor", () => {
  beforeEach(() => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = undefined;
    window.localStorage.clear();
    invalidateUserTextsCache();
  });

  it("reports availability by the tauri shell", () => {
    expect(isUserTextsAvailable()).toBe(false);
    installInvokeMock(() => ({}));
    expect(isUserTextsAvailable()).toBe(true);
  });

  it("caches the folder listing until invalidated", async () => {
    const { calls } = installInvokeMock(() => [
      { name: "poems.txt", size: 1200 },
    ]);
    const first = await userTextsList();
    const second = await userTextsList();
    expect(first).toEqual([{ name: "poems.txt", size: 1200 }]);
    expect(second).toEqual(first);
    expect(calls.filter((c) => c.cmd === "texts_list")).toHaveLength(1);
    //forced reload bypasses the cache
    await userTextsList(true);
    expect(calls.filter((c) => c.cmd === "texts_list")).toHaveLength(2);
    invalidateUserTextsCache();
    await userTextsList();
    expect(calls.filter((c) => c.cmd === "texts_list")).toHaveLength(3);
  });

  it("reads a file through the command with the name argument", async () => {
    const { calls } = installInvokeMock((_cmd, args) => {
      if (args?.["name"] === "poems.txt") return "سلام دنیا";
      return {};
    });
    const text = await userTextsRead("poems.txt");
    expect(text).toBe("سلام دنیا");
    expect(calls[0]?.cmd).toBe("texts_read");
    expect(calls[0]?.args?.["name"]).toBe("poems.txt");
  });

  it("resolves undefined on command failures and without the shell", async () => {
    installInvokeMock(() => {
      throw new Error("file too large");
    });
    expect(await userTextsRead("big.txt")).toBeUndefined();
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = undefined;
    expect(await userTextsList()).toBeUndefined();
    expect(await userTextsRead("big.txt")).toBeUndefined();
  });

  it("persists the last-picked file across reloads", () => {
    expect(getLastPickedFile()).toBeUndefined();
    setLastPickedFile("poems.txt");
    expect(getLastPickedFile()).toBe("poems.txt");
    //localStorage survives a module reload in the same tab
    invalidateUserTextsCache();
    expect(getLastPickedFile()).toBe("poems.txt");
  });
});
