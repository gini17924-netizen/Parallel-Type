import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/nitro-run/balance";
import {
  createNitroRunEngine,
  type NitroRunEngine,
  type NitroRunState,
} from "../../../src/ts/utils/nitro-run/engine";

function makeEngine(
  opts: {
    aiWpms?: number[];
    words?: string[];
  } = {},
): { engine: NitroRunEngine; state: () => NitroRunState } {
  let i = 0;
  const words = opts.words ?? ["alpha", "bravo", "charlie"];
  const engine = createNitroRunEngine({
    nextWord: () => words[i++ % words.length] ?? "alpha",
    aiWpms: opts.aiWpms ?? [45, 60, 75, 90],
  });
  return { engine, state: () => engine.state() };
}

describe("nitro run engine (idea G23 phase 1)", () => {
  it("spawns the AI field and the first word", () => {
    const { state } = makeEngine();
    const s = state();
    expect(s.ai).toHaveLength(BALANCE.aiCount);
    expect(s.currentWord).toBe("alpha");
    expect(s.distanceM).toBe(0);
    expect(s.nitroCharges).toBe(0);
    expect(s.phase).toBe("running");
  });

  it("a completed word advances the player by len x 10", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    for (const ch of "cat") engine.feedKey(ch);
    expect(state().distanceM).toBe(3 * BALANCE.progressPerCharM);
  });

  it("a wrong key spins out: typing inert for 0.5s, combo breaks", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    engine.feedKey("c");
    engine.feedKey("x"); //wrong: spin-out
    const s = state();
    expect(s.spinOutMs).toBe(BALANCE.spinOutMs);
    expect(s.combo).toBe(0);
    //typing during the spin-out is inert
    const typedBefore = state().typed;
    engine.feedKey("a");
    expect(state().typed).toBe(typedBefore);
    //the spin-out expires: typing works again
    engine.tick(BALANCE.spinOutMs + 10);
    engine.feedKey("a");
    expect(state().typed).toBe(2);
  });

  it("a 5-word streak banks a nitro charge (cap 3) and Enter burns it", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    //4 words: no charge yet
    for (let w = 0; w < 4; w++) {
      for (const ch of "cat") engine.feedKey(ch);
    }
    expect(state().nitroCharges).toBe(0);
    //the 5th word banks one
    for (const ch of "cat") engine.feedKey(ch);
    expect(state().nitroCharges).toBe(1);
    //Enter burns it: 3s of nitro, the charge spent
    engine.feedKey("Enter");
    const s = state();
    expect(s.nitroCharges).toBe(0);
    expect(s.nitroActiveMs).toBe(BALANCE.nitroDurationMs);
    //during nitro the progress doubles
    const before = state().distanceM;
    for (const ch of "cat") engine.feedKey(ch);
    const gain = state().distanceM - before;
    expect(gain).toBe(3 * BALANCE.progressPerCharM * BALANCE.nitroProgressMult);
    //Enter with no charge: nothing happens
    engine.feedKey("Enter");
    expect(state().nitroActiveMs).toBeLessThanOrEqual(BALANCE.nitroDurationMs);
  });

  it("the nitro charges cap at 3", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    for (let w = 0; w < 15; w++) {
      for (const ch of "cat") engine.feedKey(ch);
    }
    expect(state().nitroCharges).toBe(BALANCE.nitroChargesMax);
  });

  it("an idle player falls behind the nearest AI and the run ends ranked", () => {
    const { engine, state } = makeEngine({ aiWpms: [45, 60, 75, 90] });
    let guard = 0;
    while (state().phase === "running" && guard++ < 200) {
      engine.tick(100);
    }
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.rank).toBe(5); //behind all four AI
    expect(s.result).toBeDefined();
    //rank score: (5 - 5 + 1) x 100 + distance x 0.1 + perfect x 5
    expect(s.result?.rankScore).toBe(
      100 + s.distanceM * BALANCE.rankDistanceMult,
    );
  });

  it("a fast player stays ahead: no gameover while typing", () => {
    const { engine, state } = makeEngine({
      aiWpms: [45, 45, 45, 45],
      words: ["cat"], //the stream must match what the test types
    });
    //type steadily: 4 words then ticks, repeat — the player keeps pace
    for (let w = 0; w < 30; w++) {
      for (const ch of "cat") engine.feedKey(ch);
      engine.tick(400);
    }
    expect(state().phase).toBe("running");
  });

  it("perfect words: only error-free completions count", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    //word 1 with an error
    engine.feedKey("c");
    engine.feedKey("x"); //wrong: the spin-out
    engine.tick(BALANCE.spinOutMs + 10);
    engine.feedKey("a");
    engine.feedKey("t");
    //word 2 clean
    for (const ch of "cat") engine.feedKey(ch);
    expect(state().perfectWords).toBe(1);
    expect(state().streak).toBe(2);
  });

  it("the snapshot hands out fresh ai references (the KI-34 lesson)", () => {
    const { state } = makeEngine();
    const a = state().ai[0];
    const b = state().ai[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
