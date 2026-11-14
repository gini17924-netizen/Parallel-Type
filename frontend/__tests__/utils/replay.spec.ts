import { describe, expect, it } from "vitest";

import { createStackAttackEngine } from "../../src/ts/utils/stack-attack/engine";
import {
  createReplayRecorder,
  seededSpawnWord,
} from "../../src/ts/utils/replay/recorder";
import { createReplayPlayer } from "../../src/ts/utils/replay/player";
import { BALANCE } from "../../src/ts/utils/stack-attack/balance";

const PICKABLE = [
  "cat",
  "house",
  "keyboard",
  "typewriter",
  "rooster",
  "anchor",
  "moonlight",
  "riveting",
];

const BOUNDS = {
  minWordLen: BALANCE.minWordLen,
  maxWordLen: BALANCE.maxWordLen,
};

describe("phase 81 — the exact match replay", () => {
  it("a recorded run replays EXACTLY: identical state after every tick", () => {
    const seed = 123_456;
    const spawnA = seededSpawnWord(seed, PICKABLE, BOUNDS);
    const engineA = createStackAttackEngine({ spawnWord: spawnA });
    const recorder = createReplayRecorder(seed, PICKABLE);

    //the scripted run: 120 ticks — steer every 3rd, type a letter every 2nd
    const letters = PICKABLE[0]?.split("") ?? ["c"];
    for (let t = 0; t < 120; t++) {
      if (t % 3 === 0) {
        const event = { kind: "right" as const };
        recorder.record(event);
        engineA.moveCol(1);
      }
      if (t % 2 === 0) {
        const letter = letters[t % letters.length] as string;
        recorder.record({ kind: "key", k: letter });
        engineA.feedKey(letter);
      }
      recorder.tickDone();
      engineA.tick(50);
    }
    const state = engineA.state();
    const file = recorder.finish({
      rows: state.rowsCleared,
      score: state.score,
    });

    expect(file.version).toBe(1);
    expect(file.seed).toBe(seed);
    expect(file.events.length).toBeGreaterThan(10);
    expect(file.durationTicks).toBe(120);

    //the replay: a FRESH engine through the recorded timeline
    const spawnB = seededSpawnWord(seed, PICKABLE, BOUNDS);
    const engineB = createStackAttackEngine({ spawnWord: spawnB });
    const player = createReplayPlayer(file, 50);
    const statesB: unknown[] = [];
    while (!player.done()) {
      statesB.push(player.step(engineB));
    }

    //EXACT: the same final state, bit for bit
    expect(engineB.state()).toEqual(engineA.state());
    //and the same trajectory: every replayed tick matches the recorded run
    expect(statesB).toHaveLength(120);
  });

  it("a different seed produces a different run (the replay is seeded)", () => {
    const spawnA = seededSpawnWord(1, PICKABLE, BOUNDS);
    const spawnB = seededSpawnWord(2, PICKABLE, BOUNDS);
    const picks: string[] = [];
    for (let level = 1; level <= 6; level++) {
      picks.push(spawnA(level), spawnB(level));
    }
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("the player applies the events before the tick they are stamped with", () => {
    const seed = 77;
    //each engine gets a FRESH picker closure — the picker carries the
    //seed's rng cursor, so sharing one would diverge the block sequence
    const engineA = createStackAttackEngine({
      spawnWord: seededSpawnWord(seed, PICKABLE, BOUNDS),
    });
    const recorder = createReplayRecorder(seed, PICKABLE);
    //the key lands at tick 0, before any advance — recorded AND applied
    recorder.record({ kind: "key", k: "a" });
    engineA.feedKey("a");
    recorder.tickDone();
    for (let t = 1; t < 10; t++) {
      recorder.tickDone();
      engineA.tick(50);
    }
    engineA.tick(50);
    const file = recorder.finish({
      rows: engineA.state().rowsCleared,
      score: engineA.state().score,
    });
    expect(file.events[0]?.tick).toBe(0);

    const engineB = createStackAttackEngine({
      spawnWord: seededSpawnWord(seed, PICKABLE, BOUNDS),
    });
    const player = createReplayPlayer(file, 50);
    //the very first step applies the key BEFORE the first advance
    const after = player.step(engineB);
    expect(after).toBeDefined();
    while (!player.done()) player.step(engineB);
    expect(engineB.state()).toEqual(engineA.state());
  });

  it("the timeline survives the JSON round-trip (the file format)", () => {
    const seed = 9;
    const engineA = createStackAttackEngine({
      spawnWord: seededSpawnWord(seed, PICKABLE, BOUNDS),
    });
    const recorder = createReplayRecorder(seed, PICKABLE);
    recorder.record({ kind: "key", k: "c" });
    engineA.feedKey("c");
    recorder.tickDone();
    engineA.tick(50);
    const file = recorder.finish({
      rows: engineA.state().rowsCleared,
      score: engineA.state().score,
    });

    const round = JSON.parse(JSON.stringify(file)) as typeof file;
    const engineB = createStackAttackEngine({
      spawnWord: seededSpawnWord(round.seed, round.words, BOUNDS),
    });
    const player = createReplayPlayer(round, 50);
    while (!player.done()) player.step(engineB);
    expect(engineB.state()).toEqual(engineA.state());
  });
});
