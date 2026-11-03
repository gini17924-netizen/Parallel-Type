import { describe, it, expect } from "vitest";

import { computeLocalXp } from "../../src/ts/utils/local-xp";
import type { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import type { Mode } from "@monkeytype/schemas/shared";

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> = {},
): SnapshotResult<Mode> {
  return {
    _id: "xp_1",
    wpm: 80,
    rawWpm: 90,
    charStats: [48, 0, 0, 2],
    acc: 97,
    mode: "time",
    mode2: "30",
    timestamp: 1700000000000,
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 30,
    punctuation: false,
    numbers: false,
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

describe("computeLocalXp (upstream formula, local defaults)", () => {
  it("base xp = (duration - afk) * 2 with the accuracy modifier", () => {
    //30s, no afk → base 60; acc 97 → modifier (97-50)/50 = 0.94 → round(60*0.94) = 56
    expect(computeLocalXp(makeResult(), 0)).toBe(56);
  });

  it("100% accuracy adds the +0.5 bonus", () => {
    //base 60, modifier 1.5 → 90; acc 100 → 90 * 1 = 90
    const r = makeResult({ acc: 100, charStats: [50, 0, 0, 0] });
    expect(computeLocalXp(r, 0)).toBe(90);
  });

  it("corrected-everything (non-100 acc) adds +0.25", () => {
    //charStats [48,0,0,2]: missed 2 → not corrected; here missed 0 with acc<100
    const r = makeResult({ acc: 90, charStats: [48, 0, 0, 0] });
    //base 60 * 1.25 = 75 * 0.8 = 60
    expect(computeLocalXp(r, 0)).toBe(60);
  });

  it("punctuation adds +0.4", () => {
    const r = makeResult({ punctuation: true });
    //base 60 * 1.4 = 84 * 0.94 = 79 (rounds)
    expect(computeLocalXp(r, 0)).toBe(79);
  });

  it("afk time does not earn xp", () => {
    const r = makeResult({ afkDuration: 30 });
    expect(computeLocalXp(r, 0)).toBe(0);
  });

  it("streak modifier ramps to +0.5 over 10 days", () => {
    const r = makeResult({ acc: 100, charStats: [50, 0, 0, 0] });
    //no streak: 90; streak 10 → modifier 1.5 + 0.5 = 2 → 120
    expect(computeLocalXp(r, 10)).toBe(120);
  });

  it("zen mode earns nothing", () => {
    const r = makeResult({ mode: "zen", mode2: "custom" });
    expect(computeLocalXp(r, 5)).toBe(0);
  });

  it("incomplete seconds earn capped linear xp", () => {
    const r = makeResult({
      acc: 100,
      charStats: [50, 0, 0, 0],
      incompleteTestSeconds: 20,
    });
    //base 60*1.5=90*1=90 + incomplete 20 = 110
    expect(computeLocalXp(r, 0)).toBe(110);
  });

  it("acceptance (KI-23): a 5-day streak raises a 30s/97% result 56 → 73 xp", () => {
    //base 60 * (1 + 0.3 streak ramp — upstream mapRange rounds 0.25 to 0.3
    //via toFixed(1)) = 78 * 0.94 acc = 73.32 → 73
    expect(computeLocalXp(makeResult(), 5)).toBe(73);
  });
});
