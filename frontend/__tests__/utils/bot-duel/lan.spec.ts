import { beforeEach, describe, expect, it } from "vitest";

import { lanBotDuel } from "../../../src/ts/utils/bot-duel/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
  type LanGameId,
} from "../../../src/ts/utils/games/lan-registry";

describe("bot-duel LanPlayable (online wave, phase 1)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanBotDuel); //the barrel's registration, re-done per test
  });

  it("is a registry member with the duel route and picker card", () => {
    expect(getLanGames()).toHaveLength(1);
    const game = getLanGame("bot-duel");
    expect(game).toBe(lanBotDuel);
    expect(game?.route).toBe("/games/bot-duel");
    expect(game?.label).toBe("bot duel");
    expect(game?.icon).toBe("fa-robot");
  });

  it("buildStart cycles the provided pool to the race length", () => {
    const start = lanBotDuel.buildStart({
      length: 5,
      words: ["a", "bb", "ccc"],
    });
    expect(start.gameId).toBe("bot-duel");
    expect(start.params).toEqual({ length: 5 });
    expect(start.words).toEqual(["a", "bb", "ccc", "a", "bb"]);
    expect(start.seed).toBeUndefined(); //word-shipping games carry words
  });

  it("buildStart falls back to the deterministic pool without words", () => {
    const start = lanBotDuel.buildStart({ length: 4 });
    expect(start.words).toHaveLength(4);
    expect(start.words?.every((word) => typeof word === "string")).toBe(true);
  });

  it("buildStart coerces a bad length to the default", () => {
    const start = lanBotDuel.buildStart({ length: "thirty" });
    expect(start.params).toEqual({ length: 30 });
    expect(start.words).toHaveLength(30);
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanBotDuel.buildStart({ length: 2, words: ["x", "yy"] });
    expect(lanBotDuel.validateStart(good)).toBe(true);
    expect(
      lanBotDuel.validateStart({ ...good, gameId: "wrong" as LanGameId }),
    ).toBe(false);
    expect(lanBotDuel.validateStart({ ...good, params: { length: -1 } })).toBe(
      false,
    );
    expect(lanBotDuel.validateStart({ ...good, words: [] })).toBe(false);
    expect(
      lanBotDuel.validateStart({ ...good, words: ["ok", 42] as string[] }),
    ).toBe(false);
  });

  it("encodeProgress coerces garbage to zeroes", () => {
    expect(
      lanBotDuel.encodeProgress({ wordIndex: 7, correctChars: 33 }),
    ).toEqual({ wordIndex: 7, correctChars: 33 });
    expect(lanBotDuel.encodeProgress({ wordIndex: "nine" })).toEqual({
      wordIndex: 0,
      correctChars: 0,
    });
    expect(
      lanBotDuel.encodeProgress({ wordIndex: -4, correctChars: 2.9 }),
    ).toEqual({ wordIndex: 0, correctChars: 2 });
  });

  it("decodeProgress trusts only well-formed states", () => {
    expect(
      lanBotDuel.decodeProgress({ wordIndex: 3, correctChars: 12 }),
    ).toEqual({
      wordIndex: 3,
      correctChars: 12,
    });
    expect(lanBotDuel.decodeProgress({ wordIndex: 3 })).toBeUndefined();
    expect(
      lanBotDuel.decodeProgress({ wordIndex: -1, correctChars: 0 }),
    ).toBeUndefined();
    expect(lanBotDuel.decodeProgress("garbage")).toBeUndefined();
    expect(lanBotDuel.decodeProgress(null)).toBeUndefined();
  });
});
