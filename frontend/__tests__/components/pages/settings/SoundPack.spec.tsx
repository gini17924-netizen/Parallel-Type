import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

//the page pulls in config/setters (it applies the pack selection), which
//drags in test state — that fetches keyboard layouts at load, and the jsx
//project has no static mock for them (the phase 86 lesson)
vi.mock("../../../../src/ts/utils/json-data", async (importOriginal) => ({
  ...(await importOriginal()),
  getLayout: vi.fn(async () => new Promise(() => undefined)),
}));

//the common Setting reads the route search (deep-link highlight) through the
//router, which a bare card spec has no context for — the search accessor is
//the only router dependency this card's tree has
vi.mock("../../../../src/ts/router/search-params", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/ts/router/search-params")
  >()),
  useRouteSearch: () => ({
    search: () => ({ highlight: undefined }),
    replace: () => undefined,
  }),
}));

//the sound controller is a howler-heavy module — the spec spies on the
//two preview functions instead
const previewClick = vi.fn(async (_id: string) => undefined);
const previewError = vi.fn(async (_id: string) => undefined);
vi.mock(
  "../../../../src/ts/controllers/sound-controller",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/ts/controllers/sound-controller")
    >()),
    previewClick: async (id: string) => previewClick(id),
    previewError: async (id: string) => previewError(id),
  }),
);

const setConfigCalls: { key: string; value: unknown }[] = [];
vi.mock("../../../../src/ts/config/setters", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/ts/config/setters")
  >()),
  setConfig: async (key: string, value: unknown) => {
    setConfigCalls.push({ key, value });
  },
}));

import { SoundPack } from "../../../../src/ts/components/pages/settings/custom-setting/SoundPack";
import { soundPacks } from "../../../../src/ts/constants/sounds";

describe("phase 93 — the sound packs card", () => {
  beforeEach(() => {
    setConfigCalls.length = 0;
    previewClick.mockClear();
    previewError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders every pack with its pair", () => {
    const { container } = render(() => <SoundPack />);
    const text = container.textContent ?? "";
    for (const pack of soundPacks) {
      expect(text.includes(pack.label), `pack ${pack.id}`).toBe(true);
      expect(
        text.includes(`click ${pack.click} + error ${pack.error}`),
        `pack ${pack.id} pair line`,
      ).toBe(true);
    }
    //one preview button per pack
    expect(
      [...container.querySelectorAll("button")].filter((b) =>
        (b.textContent ?? "").includes("preview"),
      ),
    ).toHaveLength(soundPacks.length);
  });

  it("preview plays the pair from outside typing", async () => {
    const { container } = render(() => <SoundPack />);
    const pack = soundPacks[0] as { id: string; click: string; error: string };
    const previewBtn = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("preview"),
    ) as HTMLButtonElement;
    //the first preview button belongs to the first pack
    fireEvent.click(previewBtn);
    await vi.waitFor(() => {
      expect(previewClick).toHaveBeenCalledWith(pack.click);
      expect(previewError).toHaveBeenCalledWith(pack.error);
    });
  });

  it("use persists BOTH config keys in one action", async () => {
    const { container } = render(() => <SoundPack />);
    const pack = soundPacks[0] as { id: string; click: string; error: string };
    const useBtn = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("use"),
    ) as HTMLButtonElement;
    fireEvent.click(useBtn);
    await vi.waitFor(() => {
      expect(
        setConfigCalls.some(
          (c) => c.key === "playSoundOnClick" && c.value === pack.click,
        ),
      ).toBe(true);
      expect(
        setConfigCalls.some(
          (c) => c.key === "playSoundOnError" && c.value === pack.error,
        ),
      ).toBe(true);
    });
  });
});
