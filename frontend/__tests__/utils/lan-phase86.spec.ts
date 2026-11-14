import { beforeEach, describe, expect, it } from "vitest";

import {
  applyPreset,
  buildPresetFromConfig,
  validatePresetFile,
} from "../../src/ts/utils/preset/difficulty-preset";
import {
  championsFor,
  recordLanChampion,
  resetLanChampions,
} from "../../src/ts/utils/lan/champions";
import { __testing } from "../../src/ts/config/testing";

const { replaceConfig } = __testing;

describe("phase 86 — the difficulty preset", () => {
  beforeEach(() => {
    replaceConfig({});
  });

  it("builds the file from the live config's whitelist keys only", () => {
    replaceConfig({
      mode: "time",
      time: 60,
      difficulty: "expert",
      funbox: ["gutter"],
      //NOT on the whitelist: must never leak into the preset
      showOutOfFocusWarning: true,
      ads: "sellout",
    });
    const preset = buildPresetFromConfig("my challenge", {
      mode: "time",
      time: 60,
      difficulty: "expert",
      funbox: ["gutter"],
      showOutOfFocusWarning: true,
      ads: "sellout",
    });
    expect(preset.version).toBe(1);
    expect(preset.kind).toBe("difficulty-preset");
    expect(preset.name).toBe("my challenge");
    expect(preset.preset).toEqual({
      mode: "time",
      time: 60,
      difficulty: "expert",
      funbox: ["gutter"],
    });
  });

  it("the round-trip: validate accepts what build produced", () => {
    replaceConfig({ mode: "words", time: 30, difficulty: "normal" });
    const file = buildPresetFromConfig("challenge", {
      mode: "time",
      time: 60,
      difficulty: "expert",
    });
    const validated = validatePresetFile(JSON.parse(JSON.stringify(file)));
    expect(validated?.name).toBe("challenge");
    expect(validated?.preset.difficulty).toBe("expert");
  });

  it("rejects a wrong-kind or wrong-version file", () => {
    expect(validatePresetFile({ version: 2, kind: "difficulty-preset", name: "x", preset: {} })).toBeUndefined();
    expect(validatePresetFile({ version: 1, kind: "something-else", name: "x", preset: {} })).toBeUndefined();
    expect(validatePresetFile("garbage")).toBeUndefined();
    expect(
      validatePresetFile({
        version: 1,
        kind: "difficulty-preset",
        name: "",
        preset: { mode: "time" },
      }),
    ).toBeUndefined(); //empty name
  });

  it("a valid file passes even with only one carried key", () => {
    const preset = validatePresetFile({
      version: 1,
      kind: "difficulty-preset",
      name: "mini",
      preset: { difficulty: "master" },
    });
    expect(preset?.preset.difficulty).toBe("master");
  });
});

describe("phase 86 — the lan champions table", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetLanChampions();
  });

  it("keeps the best score per name", () => {
    recordLanChampion("bot-duel", "P2", 90, 95, 1);
    recordLanChampion("bot-duel", "P2", 70, 90, 2);
    const table = championsFor("bot-duel");
    expect(table).toHaveLength(1);
    expect(table[0]?.score).toBe(90);
    expect(table[0]?.acc).toBe(95);
  });

  it("ranks the table strongest first and caps at 10", () => {
    for (let i = 1; i <= 14; i++) {
      recordLanChampion("bot-duel", `P${i}`, i * 10, 90 + (i % 10), i);
    }
    const table = championsFor("bot-duel");
    expect(table).toHaveLength(10);
    for (let i = 1; i < table.length; i++) {
      expect(table[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(
        table[i]?.score ?? 0,
      );
    }
  });

  it("separates games completely", () => {
    recordLanChampion("bot-duel", "P1", 120, 95, 1);
    recordLanChampion("tower-defense", "P1", 60, 90, 2);
    expect(championsFor("bot-duel")[0]?.score).toBe(120);
    expect(championsFor("tower-defense")[0]?.score).toBe(60);
  });
});
