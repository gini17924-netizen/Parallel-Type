import { BALANCE, waveEnemyCount } from "./balance";

/**
 * Lane Defense wave spawner (idea G9, phase 1): builds one wave's enemy
 * spawns. With `zoneLetters` set, only words built from those letters are
 * used (the fork's educational preset — doc G9 §۰.۵, learn-groups are
 * read-only); a tiny zone falls back to synthesized pseudo-words so every
 * group stays playable. PURE: the rng is injected.
 */

export type LaneDefenseRng = () => number;

export type EnemySpawn = {
  word: string;
  speed: number;
  lane: number;
  isTank: boolean;
};

export type WaveSpawner = {
  spawnWave: (wave: number) => EnemySpawn[];
};

function lettersOf(zoneLetters: string | undefined): Set<string> | undefined {
  if (zoneLetters === undefined || zoneLetters === "") return undefined;
  return new Set([...zoneLetters.toLowerCase()]);
}

function inZone(word: string, letters: Set<string> | undefined): boolean {
  if (letters === undefined) return true;
  return [...word.toLowerCase()].every((ch) => letters.has(ch));
}

export function createWaveSpawner(options: {
  words: string[];
  rng: LaneDefenseRng;
  /** the educational zone: only words from these letters */
  zoneLetters?: string;
}): WaveSpawner {
  const letters = lettersOf(options.zoneLetters);
  const realPool = [
    ...new Set(
      options.words
        .filter(
          (word) =>
            word.length >= BALANCE.minWordLen &&
            word.length <= BALANCE.maxWordLen &&
            inZone(word, letters) &&
            /^\p{L}+$/u.test(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  const tankPool = [
    ...new Set(
      options.words
        .filter(
          (word) =>
            word.length >= BALANCE.tankMinLen &&
            word.length <= BALANCE.tankMaxLen &&
            inZone(word, letters) &&
            /^\p{L}+$/u.test(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  /** a tiny zone has no real words: synthesize pronounceable-enough
   * pseudo-words from the zone letters (doc G9 §۴ test 1's fallback) */
  const needsPseudo = realPool.length < BALANCE.zonePoolMin;
  const pseudoWord = (): string => {
    const letters2 = [...(letters ?? new Set(["a", "s", "d", "f"]))];
    if (letters2.length === 0) return "key";
    const len =
      BALANCE.pseudoMinLen +
      Math.floor(
        options.rng() * (BALANCE.pseudoMaxLen - BALANCE.pseudoMinLen + 1),
      );
    let word = "";
    for (let i = 0; i < len; i++) {
      word += letters2[Math.floor(options.rng() * letters2.length)] ?? "a";
    }
    return word;
  };
  const enemyWord = (): string =>
    needsPseudo
      ? pseudoWord()
      : (realPool[Math.floor(options.rng() * realPool.length)] ?? "type");
  const tankWord = (): string => {
    if (tankPool.length > 0 && !needsPseudo) {
      return tankPool[Math.floor(options.rng() * tankPool.length)] ?? "defense";
    }
    //a long pseudo-word from the zone letters
    const letters2 = [...(letters ?? new Set(["a", "s", "d", "f"]))];
    if (letters2.length === 0) return "defender";
    let word = "";
    for (let i = 0; i < BALANCE.tankMinLen; i++) {
      word += letters2[Math.floor(options.rng() * letters2.length)] ?? "a";
    }
    return word;
  };

  return {
    spawnWave(wave: number): EnemySpawn[] {
      const count = waveEnemyCount(wave);
      const speedBase =
        BALANCE.baseSpeedVwPerSec +
        (Math.max(wave, 1) - 1) * BALANCE.speedPerWaveVw;
      const spawns: EnemySpawn[] = [];
      for (let i = 0; i < count; i++) {
        spawns.push({
          word: enemyWord(),
          speed: speedBase + options.rng() * BALANCE.speedJitterVw,
          lane: Math.floor(options.rng() * BALANCE.lanes),
          isTank: false,
        });
      }
      if (wave % BALANCE.tankEveryWaves === 0 && spawns.length > 0) {
        const last = spawns.length - 1;
        spawns[last] = {
          word: tankWord(),
          speed:
            (speedBase + options.rng() * BALANCE.speedJitterVw) *
            BALANCE.tankSpeedMult,
          lane: spawns[last]?.lane ?? 0,
          isTank: true,
        };
      }
      return spawns;
    },
  };
}
