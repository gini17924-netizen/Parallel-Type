import { describe, expect, it } from "vitest";

import { soundPacks, soundsConfig } from "../../src/ts/constants/sounds";

const VALID_CLICK_IDS = new Set(Object.keys(soundsConfig).concat("off"));
const VALID_ERROR_IDS = new Set(["1", "2", "3", "4"]);

describe("phase 93 — the sound packs", () => {
  it("every pack carries a complete identity: non-empty id/label + both sounds", () => {
    expect(soundPacks.length).toBeGreaterThan(0);
    for (const pack of soundPacks) {
      expect(pack.id.trim(), `pack ${pack.id} id`).not.toBe("");
      expect(pack.label.trim(), `pack ${pack.id} label`).not.toBe("");
      expect(VALID_CLICK_IDS.has(pack.click), `pack ${pack.id} click`).toBe(
        true,
      );
      expect(VALID_ERROR_IDS.has(pack.error), `pack ${pack.id} error`).toBe(
        true,
      );
    }
  });

  it("the pack ids are unique", () => {
    const ids = soundPacks.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every referenced click scheme exists in the registry", () => {
    for (const pack of soundPacks) {
      expect(
        soundsConfig[pack.click],
        `scheme ${pack.click} from pack ${pack.id}`,
      ).toBeDefined();
    }
  });

  it("the pairs are heterogeneous enough to be worth a pack list", () => {
    //at least three distinct click schemes and two distinct error sounds
    const clicks = new Set(soundPacks.map((p) => p.click));
    const errors = new Set(soundPacks.map((p) => p.error));
    expect(clicks.size).toBeGreaterThanOrEqual(3);
    expect(errors.size).toBeGreaterThanOrEqual(2);
  });
});
