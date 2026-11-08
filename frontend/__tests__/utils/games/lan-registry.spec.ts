import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetLanRegistryForTests,
  createLanSeed,
  getLanGame,
  getLanGames,
  registerLanGame,
  type LanPlayable,
} from "../../../src/ts/utils/games/lan-registry";

function fakeGame(id: "bot-duel"): LanPlayable {
  return {
    gameId: id,
    route: "/games/whatever",
    label: "whatever",
    icon: "fa-question",
    buildStart: () => ({ gameId: id, params: {} }),
    validateStart: () => true,
    encodeProgress: (state) => state,
    decodeProgress: () => undefined,
  };
}

describe("lan registry (online wave, phase 1)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
  });

  it("registers, looks up and lists in insertion order", () => {
    const game = fakeGame("bot-duel");
    registerLanGame(game);
    expect(getLanGame("bot-duel")).toBe(game);
    expect(getLanGames()).toEqual([game]);
  });

  it("throws on a duplicate registration (a bug, not a feature)", () => {
    registerLanGame(fakeGame("bot-duel"));
    expect(() => registerLanGame(fakeGame("bot-duel"))).toThrow(
      /already registered/,
    );
  });

  it("createLanSeed stays a positive 31-bit integer", () => {
    for (let i = 0; i < 50; i++) {
      const seed = createLanSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(1);
      expect(seed).toBeLessThanOrEqual(2147483647);
    }
  });
});
