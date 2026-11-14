import { BALANCE, comboMult } from "./balance";
import type { EnemySpawn } from "./spawner";

/**
 * Tower Defense engine (phase 85): enemies spawn staggered ABOVE the
 * field carrying words and march DOWN toward the tower; typing the full
 * word of the targeted enemy destroys it. Target selection: a STARTED
 * word first, else the enemy nearest the tower (largest y) — the Lane
 * Defense pattern turned vertical. A wrong key breaks the combo (typed
 * stays); an enemy crossing the tower line costs 1 tower hp and breaks
 * the combo; the tower repairs +2 per cleared wave (capped); tower 0 =
 * the run is over. Every 3rd wave carries a tank (long word, slow, 3x
 * score).
 *
 * PURE: the injected spawnWave callback supplies the enemies; dtMs scales
 * the march. The snapshot hands out fresh per-enemy references (KI-34).
 */

export type TowerDefensePhase = "running" | "done";

export type TowerEnemy = {
  id: number;
  word: string;
  /** chars consumed (a started enemy has priority as the target) */
  typed: number;
  /** top-based vh: grows as the enemy marches; >= tower = breach */
  y: number;
  speed: number;
  lane: number;
  isTank: boolean;
};

export type TowerDefenseResult = {
  score: number;
  wave: number;
  kills: number;
  maxCombo: number;
  towerHp: number;
};

export type TowerDefenseState = {
  phase: TowerDefensePhase;
  score: number;
  wave: number;
  towerHp: number;
  combo: number;
  maxCombo: number;
  kills: number;
  enemies: TowerEnemy[];
  wavesCleared: number;
  result: TowerDefenseResult | undefined;
};

export type TowerDefenseEngine = {
  state(): TowerDefenseState;
  /** advances the march by dtMs: movement, tower breaches, wave repair */
  tick(dtMs: number): TowerDefenseState;
  /** one keystroke against the targeted enemy */
  feedKey(key: string): TowerDefenseState;
};

export function createTowerDefenseEngine(options: {
  /** supplies one wave's spawns (the seeded spawner in the page) */
  spawnWave: (wave: number) => EnemySpawn[];
  towerHp?: number;
}): TowerDefenseEngine {
  let phase: TowerDefensePhase = "running";
  let score = 0;
  let wave = 1;
  let wavesCleared = 0;
  let towerHp = options.towerHp ?? BALANCE.towerStartHp;
  let combo = 0;
  let maxCombo = 0;
  let kills = 0;
  let nextId = 1;
  const enemies: TowerEnemy[] = [];

  function spawnWaveEnemies(waveNumber: number): void {
    const spawns = options.spawnWave(waveNumber);
    for (const spawn of spawns) {
      enemies.push({
        id: nextId++,
        word: spawn.word,
        typed: 0,
        //staggered above-screen entry; same-lane enemies keep their order
        y: BALANCE.enemyStartYVw + enemies.length * BALANCE.enemySpacingYVw,
        speed: spawn.speed,
        lane: spawn.lane,
        isTank: spawn.isTank,
      });
    }
  }

  spawnWaveEnemies(wave);

  function snapshot(): TowerDefenseState {
    return {
      phase,
      score,
      wave,
      towerHp,
      combo,
      maxCombo,
      kills,
      enemies: enemies.map((enemy) => ({ ...enemy })),
      wavesCleared,
      result: phase === "done" ? finishResult() : undefined,
    };
  }

  function finishResult(): TowerDefenseResult {
    return { score, wave, kills, maxCombo, towerHp };
  }

  function target(): TowerEnemy | undefined {
    //a started word first, else the enemy nearest the tower (largest y)
    const started = enemies.find((enemy) => enemy.typed > 0);
    if (started !== undefined) return started;
    let nearest: TowerEnemy | undefined;
    for (const enemy of enemies) {
      if (nearest === undefined || enemy.y > nearest.y) nearest = enemy;
    }
    return nearest;
  }

  function advanceWaveIfEmpty(): void {
    if (phase !== "running" || enemies.length > 0) return;
    wavesCleared = wave;
    wave += 1;
    towerHp = Math.min(
      BALANCE.towerStartHp,
      towerHp + BALANCE.towerRepairPerWave,
    );
    spawnWaveEnemies(wave);
  }

  function kill(enemy: TowerEnemy): void {
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
        enemy.y += enemy.speed * seconds;
        if (enemy.y >= BALANCE.towerYVh) {
          //a breach: the tower takes the hit and the combo breaks
          enemies.splice(i, 1);
          towerHp -= 1;
          combo = 0;
        }
      }
      if (towerHp <= 0) {
        towerHp = 0;
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
