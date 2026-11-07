import { BALANCE, comboMult } from "./balance";

/**
 * Letter Strike engine (idea G8, phase 1): ZType-lite — ships fall with an
 * attached word; typing a word's first letter locks the nearest ship, each
 * correct letter is a shot, completing the word destroys the ship. Wrong
 * letters are inert (no penalty, doc G8 §۰.۲); Backspace rewinds the lock
 * one letter and releases at zero. A ship reaching the floor costs a life
 * (3) and breaks the combo. Waves step 4 -> 14 ships; every 4th wave
 * carries a Boss (long word, two full passages — the prefix resets after
 * the first). Space fires the EMP when charged: clears every ship on
 * screen for no score; it recharges every 3 cleared waves.
 *
 * PURE: the injected spawnWave callback supplies each wave's words/speeds;
 * dtMs scales the fall. The snapshot hands out fresh per-ship references
 * (the UI's <For> keys by reference — the KI-34 lesson).
 */

export type LetterStrikePhase = "running" | "done";

export type StrikeShip = {
  id: number;
  word: string;
  /** letters consumed while locked (0 = not started) */
  typed: number;
  /** top-based vh: grows as the ship falls; >= limit = escape */
  y: number;
  /** vh per second */
  speed: number;
  isBoss: boolean;
  /** full passages still required (bosses carry BALANCE.bossArmor) */
  armorHp: number;
};

export type LetterStrikeResult = {
  score: number;
  wave: number;
  shipsDestroyed: number;
  maxCombo: number;
};

export type LetterStrikeState = {
  phase: LetterStrikePhase;
  score: number;
  wave: number;
  lives: number;
  combo: number;
  maxCombo: number;
  shipsDestroyed: number;
  ships: StrikeShip[];
  lockedShipId: number | undefined;
  empCharged: boolean;
  wavesCleared: number;
  result: LetterStrikeResult | undefined;
};

export type WaveSpawn = { word: string; speed: number; isBoss: boolean };

export type LetterStrikeEngine = {
  state(): LetterStrikeState;
  /** advances the fall by dtMs: movement, escapes, floor deaths */
  tick(dtMs: number): LetterStrikeState;
  /** one keystroke: lock/shot/backspace/EMP (wrong letters are inert) */
  feedKey(key: string): LetterStrikeState;
};

export function createLetterStrikeEngine(options: {
  /** supplies one wave's spawns (words already filtered by the spawner) */
  spawnWave: (wave: number) => WaveSpawn[];
  lives?: number;
}): LetterStrikeEngine {
  let phase: LetterStrikePhase = "running";
  let score = 0;
  let wave = 1;
  let wavesCleared = 0;
  let lives = options.lives ?? BALANCE.lives;
  let combo = 0;
  let maxCombo = 0;
  let shipsDestroyed = 0;
  let lockedShipId: number | undefined;
  let empCharged = false;
  let nextId = 1;
  const ships: StrikeShip[] = [];

  function spawnWaveShips(waveNumber: number): void {
    const spawns = options.spawnWave(waveNumber);
    for (const spawn of spawns) {
      ships.push({
        id: nextId++,
        word: spawn.word,
        typed: 0,
        y: BALANCE.spawnYStartVh - ships.length * BALANCE.shipSpacingVh,
        speed: spawn.speed,
        isBoss: spawn.isBoss,
        armorHp: spawn.isBoss ? BALANCE.bossArmor : 1,
      });
    }
  }

  spawnWaveShips(wave);

  function snapshot(): LetterStrikeState {
    return {
      phase,
      score,
      wave,
      lives,
      combo,
      maxCombo,
      shipsDestroyed,
      //fresh references: the page's <For> keys by reference (KI-34 lesson)
      ships: ships.map((ship) => ({ ...ship })),
      lockedShipId,
      empCharged,
      wavesCleared,
      result: phase === "done" ? finishResult() : undefined,
    };
  }

  function finishResult(): LetterStrikeResult {
    return { score, wave, shipsDestroyed, maxCombo };
  }

  /** when the screen empties (destructions or an EMP) the next wave comes
   * and every 3rd cleared wave recharges the EMP (doc G8 §۰.۵) */
  function advanceWaveIfEmpty(): void {
    if (phase !== "running" || ships.length > 0) return;
    wavesCleared = wave;
    wave += 1;
    if (wavesCleared % BALANCE.empRechargeEveryWaves === 0) {
      empCharged = true;
    }
    spawnWaveShips(wave);
  }

  function destroyShip(ship: StrikeShip): void {
    const index = ships.findIndex((s) => s.id === ship.id);
    if (index !== -1) ships.splice(index, 1);
    lockedShipId = undefined;
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    shipsDestroyed += 1;
    score += ship.word.length * BALANCE.scorePerChar * comboMult(combo);
    advanceWaveIfEmpty();
  }

  function fireEmp(): void {
    if (!empCharged) return;
    empCharged = false;
    ships.length = 0;
    lockedShipId = undefined;
    advanceWaveIfEmpty();
  }

  function handleBackspace(): void {
    const locked = ships.find((s) => s.id === lockedShipId);
    if (locked === undefined || locked.typed === 0) return;
    locked.typed -= 1;
    if (locked.typed === 0) lockedShipId = undefined;
  }

  function handleChar(ch: string): void {
    const locked = ships.find((s) => s.id === lockedShipId);
    if (locked !== undefined) {
      const expected = locked.word[locked.typed]?.toLowerCase();
      if (expected !== ch) return; //inert while locked (doc G8 §۰.۲)
      locked.typed += 1;
      if (locked.typed >= locked.word.length) {
        if (locked.armorHp > 1) {
          //first boss passage: it explodes back to a fresh prefix
          locked.armorHp -= 1;
          locked.typed = 0;
          lockedShipId = undefined;
        } else {
          destroyShip(locked);
        }
      }
      return;
    }
    //unlocked: the first letter locks the NEAREST candidate (largest y =
    //closest to the floor) whose word starts with the letter
    let nearest: StrikeShip | undefined;
    for (const ship of ships) {
      if (ship.word[0]?.toLowerCase() !== ch) continue;
      if (nearest === undefined || ship.y > nearest.y) nearest = ship;
    }
    if (nearest === undefined) return; //inert when unlocked
    lockedShipId = nearest.id;
    nearest.typed = 1;
    if (nearest.typed >= nearest.word.length) destroyShip(nearest);
  }

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running") return snapshot();
      const seconds = dtMs / 1000;
      for (let i = ships.length - 1; i >= 0; i--) {
        const ship = ships[i];
        if (ship === undefined) continue;
        ship.y += ship.speed * seconds;
        if (ship.y >= BALANCE.shipYLimitVh) {
          //a ship reaching the floor: a life + the combo breaks
          ships.splice(i, 1);
          if (lockedShipId === ship.id) lockedShipId = undefined;
          lives -= 1;
          combo = 0;
        }
      }
      if (lives <= 0) {
        lives = 0;
        phase = "done";
        return snapshot();
      }
      advanceWaveIfEmpty();
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (key === " ") {
        fireEmp();
        return snapshot();
      }
      if (key === "Backspace") {
        handleBackspace();
        return snapshot();
      }
      if (key.length !== 1) return snapshot(); //Enter/modifiers: inert
      handleChar(key.toLowerCase());
      return snapshot();
    },
  };
}
