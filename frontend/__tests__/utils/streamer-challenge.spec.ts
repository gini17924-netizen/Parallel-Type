import { beforeEach, describe, expect, it } from "vitest";

import {
  challengeCodeForDay,
  challengeDayKey,
  codeFromChallengeDayKey,
  normalizeChallengeCode,
} from "../../src/ts/utils/daily-gauntlet/challenge";
import { buildDaily, hashKey } from "../../src/ts/utils/daily-gauntlet/compose";
import { registerDailyBotDuel } from "../../src/ts/utils/bot-duel/daily";
import { registerDailySprint } from "../../src/ts/utils/sprint/daily";
import { registerDailyWordBlast } from "../../src/ts/utils/word-blast/daily";
import { listDailyPlayables } from "../../src/ts/utils/games/game-registry";
import {
  applyStreamerModeAtBoot,
  resetStreamerMode,
  setStreamerModeEnabled,
  streamerModeEnabled,
} from "../../src/ts/utils/streamer-mode";

describe("phase 99 — the streamer mode switch", () => {
  beforeEach(() => {
    resetStreamerMode();
  });

  it("the toggle persists and flips the body class", () => {
    expect(streamerModeEnabled()).toBe(false);
    expect(document.body.classList.contains("streamer-mode")).toBe(false);
    setStreamerModeEnabled(true);
    expect(streamerModeEnabled()).toBe(true);
    expect(document.body.classList.contains("streamer-mode")).toBe(true);
    setStreamerModeEnabled(false);
    expect(streamerModeEnabled()).toBe(false);
    expect(document.body.classList.contains("streamer-mode")).toBe(false);
  });

  it("the boot re-applies the persisted class (a fresh user stays off)", () => {
    setStreamerModeEnabled(true);
    document.body.classList.remove("streamer-mode");
    applyStreamerModeAtBoot();
    expect(document.body.classList.contains("streamer-mode")).toBe(true);
    resetStreamerMode();
    applyStreamerModeAtBoot();
    expect(document.body.classList.contains("streamer-mode")).toBe(false);
  });
});

describe("phase 99 — the challenge codes (pure)", () => {
  it("normalize accepts 4-16 A-Z0-9 and rejects the rest", () => {
    expect(normalizeChallengeCode("abcd-1234")).toBe("ABCD1234");
    expect(normalizeChallengeCode("  gauntlet99  ")).toBe("GAUNTLET99");
    expect(normalizeChallengeCode("abc")).toBeUndefined();
    expect(normalizeChallengeCode("!!")).toBeUndefined();
    expect(normalizeChallengeCode("")).toBeUndefined();
    expect(normalizeChallengeCode("x".repeat(17))).toBeUndefined();
  });

  it("the daily code is deterministic and shares the alphabet", () => {
    const monday = challengeCodeForDay("2026-11-16");
    expect(monday).toBe(challengeCodeForDay("2026-11-16"));
    expect(monday).not.toBe(challengeCodeForDay("2026-11-17"));
    expect(monday).toMatch(/^[A-HJ-NP-Z2-9]{6}$/u);
  });

  it("the same code composes the SAME gauntlet for everyone", () => {
    //register the daily wrappers exactly as the gauntlet page's boot does
    registerDailyBotDuel();
    registerDailySprint();
    registerDailyWordBlast();
    const playables = listDailyPlayables();
    expect(playables.length).toBeGreaterThanOrEqual(3);
    const stagesA = buildDaily("GAUNTLET99", playables);
    const stagesB = buildDaily("GAUNTLET99", playables);
    expect(stagesA).toEqual(stagesB);
    //and a DIFFERENT code composes a different challenge
    const stagesOther = buildDaily("GAUNTLET98", playables);
    expect(stagesA.map((s) => s.gameId).join()).not.toBe(
      stagesOther.map((s) => s.gameId).join(),
    );
  });

  it("the challenge slot dayKey round-trips and never collides with a real day", () => {
    const code = normalizeChallengeCode("gauntlet99") as string;
    const slot = challengeDayKey(code);
    expect(slot.startsWith("challenge:")).toBe(true);
    expect(codeFromChallengeDayKey(slot)).toBe(code);
    expect(codeFromChallengeDayKey("2026-11-16")).toBeUndefined();
    expect(slot).not.toBe("2026-11-16");
  });

  it("the code alphabet excludes the ambiguous glyphs (I/1, O/0)", () => {
    const codes = new Set(
      ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"].map(
        challengeCodeForDay,
      ),
    );
    for (const code of codes) {
      expect(code.includes("I")).toBe(false);
      expect(code.includes("O")).toBe(false);
    }
    expect(hashKey("challenge:2026-11-14")).toBeGreaterThan(0);
  });
});
