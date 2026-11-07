import { BALANCE, comboMult } from "./balance";
import type { EnemySpawn } from "./spawner";

/**
 * Lane Defense engine (idea G9, phase 1): enemies walk right -> left
 * across 5 lanes toward the wall; typing the full word of the targeted
 * enemy destroys it. Target selection: a STARTED word first, else the
 * enemy nearest the wall (smallest x) — the Word Blast pattern turned
 * horizontal. A wrong key breaks the combo (typed stays); an enemy
 * crossing the wall line costs 1 wall hp and breaks the combo; the wall
 * repairs +2 per cleared wave (capped); wall 0 = the run is over. Every
 * 3rd wave carries a tank (long word, slow, 3x score).
 *
 * PURE: the injected spawnWave callback supplies the enemies; dtMs scales
 * the walk. The snapshot hands out fresh per-enemy references (KI-34).
 */

export type LaneDefensePhase = "running" | "done";

export type LaneEnemy = {
  id: number;
  word: string;
  /** chars consumed (a started enemy has priority as the target) */
  typed: number;
  /** top-based... left-based vw: shrinks as the enemy walks; <= wall = breach */
  x: number;
  speed: number;
  lane: number;
  isTank: boolean;
};

export type LaneDefenseResult = {
  score: number;
  wave: number;
  kills: number;
  maxCombo: number;
  wallHp: number;
};

export type LaneDefenseState = {
  phase: LaneDefensePhase;
  score: number;
  wave: number;
  wallHp: number;
  combo: number;
  maxCombo: number;
  kills: number;
  enemies: LaneEnemy[];
  wavesCleared: number;
  result: LaneDefenseResult | undefined;
};

export type LaneDefenseEngine = {
  state(): LaneDefenseState;
  /** advances the walk by dtMs: movement, wall breaches, wave repair */
  tick(dtMs: number): LaneDefenseState;
  /** one keystroke against the targeted enemy */
  feedKey(key: string): LaneDefenseState;
};

export function createLaneDefenseEngine(options: {
  /** supplies one wave's spawns (already zone-filtered by the spawner) */
  spawnWave: (wave: number) => EnemySpawn[];
  wallHp?: number;
}): LaneDefenseEngine {
  let phase: LaneDefensePhase = "running";
  let score = 0;
  let wave = 1;
  let wavesCleared = 0;
  let wallHp = options.wallHp ?? BALANCE.wallStartHp;
  let combo = 0;
  let maxCombo = 0;
  let kills = 0;
  let nextId = 1;
  const enemies: LaneEnemy[] = [];

  function spawnWaveEnemies(waveNumber: number): void {
    const spawns = options.spawnWave(waveNumber);
    for (const spawn of spawns) {
      enemies.push({
        id: nextId++,
        word: spawn.word,
        typed: 0,
        //staggered off-screen entry; same-lane enemies keep their order
        x: BALANCE.enemyStartXVw + enemies.length * BALANCE.enemySpacingVw,
        speed: spawn.speed,
        lane: spawn.lane,
        isTank: spawn.isTank,
      });
    }
  }

  spawnWaveEnemies(wave);

  function snapshot(): LaneDefenseState {
    return {
      phase,
      score,
      wave,
      wallHp,
      combo,
      maxCombo,
      kills,
      enemies: enemies.map((enemy) => ({ ...enemy })),
      wavesCleared,
      result: phase === "done" ? finishResult() : undefined,
    };
  }

  function finishResult(): LaneDefenseResult {
    return { score, wave, kills, maxCombo, wallHp };
  }

  function target(): LaneEnemy | undefined {
    //a started word first, else the enemy nearest the wall (smallest x)
    const started = enemies.find((enemy) => enemy.typed > 0);
    if (started !== undefined) return started;
    let nearest: LaneEnemy | undefined;
    for (const enemy of enemies) {
      if (nearest === undefined || enemy.x < nearest.x) nearest = enemy;
    }
    return nearest;
  }

  function advanceWaveIfEmpty(): void {
    if (phase !== "running" || enemies.length > 0) return;
    wavesCleared = wave;
    wave += 1;
    wallHp = Math.min(BALANCE.wallStartHp, wallHp + BALANCE.wallRepairPerWave);
    spawnWaveEnemies(wave);
  }

  function kill(enemy: LaneEnemy): void {
    const index = enemies.findIndex((e) => e.id === enemy.id);
    if (index !== -1) enemies.splice(index, 1);
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    kills += 1;
    const mult = enemy.isTank ? BALANCE.tankScoreMult : comboMult(combo);
    score += enemy.word.length * BALANCE.scorePerChar * mult;
    advanceWaveIfEmpty();
  }

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running") return snapshot();
      const seconds = dtMs / 1000;
      for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy === undefined) continue;
        enemy.x -= enemy.speed * seconds;
        if (enemy.x <= BALANCE.wallXVw) {
          //a breach: the wall takes the hit and the combo breaks
          enemies.splice(i, 1);
          wallHp -= 1;
          combo = 0;
        }
      }
      if (wallHp <= 0) {
        wallHp = 0;
        phase = "done";
        return snapshot();
      }
      advanceWaveIfEmpty();
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (key.length !== 1) return snapshot(); //Backspace/Enter: inert here
      const ch = key.toLowerCase();
      const enemy = target();
      if (enemy === undefined) return snapshot();
      const expected = enemy.word[enemy.typed]?.toLowerCase();
      if (expected !== ch) {
        //a wrong key on the current word: only the combo breaks
        combo = 0;
        return snapshot();
      }
      enemy.typed += 1;
      if (enemy.typed >= enemy.word.length) kill(enemy);
      return snapshot();
    },
  };
}
