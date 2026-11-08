import { BALANCE, comboMult } from "./balance";
import { apexTimeMs, stepArc } from "./physics";

/**
 * Fruit Slash engine (idea G10, phase 1): fruits fly in arcs from the
 * bottom; the player types ANY visible word (word-oriented matching —
 * per-fruit partials advance independently, a wrong key resets that
 * fruit's partial only). Completing a fruit's word slashes it
 * (len x 10 x comboMult, +30 when slashed within +-150ms of the arc's
 * apex); completing a BOMB's word costs a life — 3 typed bombs end the
 * run early; the fixed 90-second window ends it otherwise. A fruit that
 * lands is an escape (combo break); a fruit leaving the sides is removed
 * without penalty; a bomb held half-typed for 2s defuses itself.
 *
 * PURE: the injected spawn(level) callback supplies words (the bomb mix
 * is the caller's policy); the rng is injected for the launch angles.
 */

export type FruitSlashPhase = "running" | "done";

export type FlyingFruit = {
  id: number;
  word: string;
  /** chars consumed of THIS fruit's word (per-fruit partial map) */
  typed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isBomb: boolean;
  /** self-defused after the half-life (no longer costs a life) */
  defused: boolean;
  /** ms since the launch (the apex bonus compares against apexAtMs) */
  ageMs: number;
  apexAtMs: number;
  /** when the current partial started (the bomb half-life clock) */
  partialSinceMs: number;
};

export type FruitSlashResult = {
  score: number;
  slashed: number;
  escaped: number;
  bombsTyped: number;
  maxCombo: number;
  /** "time" = the 90s window elapsed; "bombs" = 3 bombs typed */
  endedBy: "time" | "bombs";
};

export type FruitSlashState = {
  phase: FruitSlashPhase;
  score: number;
  combo: number;
  maxCombo: number;
  slashed: number;
  escaped: number;
  bombsTyped: number;
  level: number;
  elapsedMs: number;
  remainingMs: number;
  fruits: FlyingFruit[];
  result: FruitSlashResult | undefined;
};

export type FruitSlashEngine = {
  state(): FruitSlashState;
  /** advances the arcs, the spawn cadence and the bomb half-lives */
  tick(dtMs: number): FruitSlashState;
  /** one keystroke against every visible fruit's matcher */
  feedKey(key: string): FruitSlashState;
};

export function createFruitSlashEngine(options: {
  /** supplies one fruit's word; the bomb mix is the caller's policy */
  spawn: (level: number) => { word: string; isBomb: boolean };
  rng: () => number;
  durationMs?: number;
}): FruitSlashEngine {
  const durationMs = options.durationMs ?? BALANCE.durationMs;
  let phase: FruitSlashPhase = "running";
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let slashed = 0;
  let escaped = 0;
  let bombsTyped = 0;
  let elapsedMs = 0;
  //the first fruit launches on the FIRST tick (no dead second at start)
  let spawnAcc: number = BALANCE.spawnIntervalStartMs;
  let nextId = 1;
  const fruits: FlyingFruit[] = [];

  function level(): number {
    return 1 + Math.floor(slashed / BALANCE.levelStep);
  }

  function spawnInterval(): number {
    return Math.max(
      BALANCE.spawnIntervalMinMs,
      BALANCE.spawnIntervalStartMs -
        (level() - 1) * BALANCE.spawnIntervalDecayMs,
    );
  }

  function launch(): void {
    const spawned = options.spawn(level());
    const vy = -(
      BALANCE.launchVyMinVh +
      options.rng() * (BALANCE.launchVyMaxVh - BALANCE.launchVyMinVh)
    );
    const direction = options.rng() < 0.5 ? -1 : 1;
    const vx =
      direction *
      (BALANCE.launchVxMinVw +
        options.rng() * (BALANCE.launchVxMaxVw - BALANCE.launchVxMinVw));
    fruits.push({
      id: nextId++,
      word: spawned.word,
      typed: 0,
      x:
        BALANCE.launchXMinVw +
        options.rng() * (BALANCE.launchXMaxVw - BALANCE.launchXMinVw),
      y: BALANCE.launchYVh,
      vx,
      vy,
      isBomb: spawned.isBomb,
      defused: false,
      ageMs: 0,
      partialSinceMs: 0,
      apexAtMs: apexTimeMs(vy, BALANCE.gravityVhPerSec2),
    });
  }

  function finish(endedBy: "time" | "bombs"): FruitSlashState {
    phase = "done";
    return snapshotWith({
      phase,
      result: {
        score,
        slashed,
        escaped,
        bombsTyped,
        maxCombo,
        endedBy,
      },
    });
  }

  function snapshotWith(extra: Partial<FruitSlashState>): FruitSlashState {
    return {
      phase,
      score,
      combo,
      maxCombo,
      slashed,
      escaped,
      bombsTyped,
      level: level(),
      elapsedMs,
      remainingMs: Math.max(0, durationMs - elapsedMs),
      //fresh references: the page's <For> keys by reference (KI-34 lesson)
      fruits: fruits.map((fruit) => ({ ...fruit })),
      result: phase === "done" ? finishResult() : undefined,
      ...extra,
    };
  }

  function finishResult(): FruitSlashResult {
    return {
      score,
      slashed,
      escaped,
      bombsTyped,
      maxCombo,
      endedBy: bombsTyped >= BALANCE.maxTypedBombs ? "bombs" : "time",
    };
  }

  function slash(fruit: FlyingFruit): void {
    const index = fruits.findIndex((f) => f.id === fruit.id);
    if (index !== -1) fruits.splice(index, 1);
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    slashed += 1;
    score += fruit.word.length * BALANCE.scorePerChar * comboMult(combo);
    if (Math.abs(fruit.ageMs - fruit.apexAtMs) <= BALANCE.apexWindowMs) {
      score += BALANCE.apexBonus;
    }
  }

  function typeBomb(fruit: FlyingFruit): void {
    const index = fruits.findIndex((f) => f.id === fruit.id);
    if (index !== -1) fruits.splice(index, 1);
    bombsTyped += 1;
    if (bombsTyped >= BALANCE.maxTypedBombs) {
      phase = "done";
    }
  }

  //the first fruit is airborne immediately (the other games launch at
  //construction too — the tick only drives the cadence)
  launch();

  return {
    state: () => snapshotWith({}),
    tick(dtMs) {
      if (phase !== "running") return snapshotWith({});
      elapsedMs += dtMs;
      if (elapsedMs >= durationMs) {
        elapsedMs = durationMs;
        return finish("time");
      }
      const seconds = dtMs / 1000;
      for (let i = fruits.length - 1; i >= 0; i--) {
        const fruit = fruits[i];
        if (fruit === undefined) continue;
        fruit.ageMs += dtMs;
        const stepped = stepArc(
          fruit.x,
          fruit.y,
          fruit.vx,
          fruit.vy,
          seconds,
          BALANCE.gravityVhPerSec2,
        );
        fruit.x = stepped.x;
        fruit.y = stepped.y;
        fruit.vy = stepped.vy;
      }
      //the bomb half-life pass (typedAtMs set when the partial grows)
      for (let i = fruits.length - 1; i >= 0; i--) {
        const fruit = fruits[i];
        if (fruit === undefined) continue;
        if (
          fruit.isBomb &&
          !fruit.defused &&
          fruit.typed > 0 &&
          fruit.typed < fruit.word.length &&
          fruit.ageMs - fruit.partialSinceMs >= BALANCE.bombHalfLifeMs
        ) {
          fruit.defused = true;
        }
        //leave the screen below = escaped (a combo break); the sides =
        //removed without penalty (doc G10 §۵)
        if (fruit.y > BALANCE.floorYVh) {
          fruits.splice(i, 1);
          escaped += 1;
          combo = 0;
        } else if (
          fruit.x < -BALANCE.offScreenXVw ||
          fruit.x > 100 + BALANCE.offScreenXVw
        ) {
          fruits.splice(i, 1);
        }
      }
      //the spawn cadence: capped in-flight, interval decays with level
      spawnAcc += dtMs;
      const interval = spawnInterval();
      while (spawnAcc >= interval && fruits.length < BALANCE.maxInFlight) {
        spawnAcc -= interval;
        launch();
      }
      if (fruits.length >= BALANCE.maxInFlight) spawnAcc = 0;
      return snapshotWith({});
    },
    feedKey(key) {
      if (phase !== "running") return snapshotWith({});
      if (key.length !== 1) return snapshotWith({});
      const ch = key.toLowerCase();
      let bombExploded = false;
      for (const fruit of [...fruits]) {
        const expected = fruit.word[fruit.typed]?.toLowerCase();
        if (expected === ch) {
          fruit.typed += 1;
          if (fruit.typed >= fruit.word.length) {
            if (fruit.isBomb && !fruit.defused) {
              typeBomb(fruit);
              bombExploded = true;
            } else {
              slash(fruit);
            }
          } else if (fruit.isBomb && fruit.typed === 1) {
            fruit.partialSinceMs = fruit.ageMs;
          }
        } else if (fruit.typed > 0) {
          //a wrong key resets THAT fruit's partial (doc G10 §۰.۲)
          fruit.typed = 0;
        }
      }
      if (bombExploded && bombsTyped >= BALANCE.maxTypedBombs) {
        return finish("bombs");
      }
      return snapshotWith({});
    },
  };
}
