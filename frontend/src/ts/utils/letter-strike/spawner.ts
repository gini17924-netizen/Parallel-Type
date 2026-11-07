import { BALANCE, waveShipCount } from "./balance";
import type { WaveSpawn } from "./engine";

/**
 * Letter Strike wave spawner (idea G8, phase 1): builds one wave's spawns
 * from the language's word list — ship count steps 4 -> 14, speed scales
 * with the wave, every 4th wave carries one Boss (long word, slower).
 * PURE: the rng is injected; the same seed builds the same wave.
 */

export type LetterStrikeRng = () => number;

/** pure-letter words only: code_* languages carry symbols that the simple
 * lowercase matching would eat (doc G8 §۵) */
export function isTypeableWord(word: string): boolean {
  return /^\p{L}+$/u.test(word);
}

export type WaveSpawner = {
  spawnWave: (wave: number) => WaveSpawn[];
};

export function createWaveSpawner(options: {
  words: string[];
  rng: LetterStrikeRng;
}): WaveSpawner {
  const pool = [
    ...new Set(
      options.words
        .filter(
          (word) =>
            word.length >= BALANCE.minWordLen &&
            word.length <= BALANCE.maxWordLen &&
            isTypeableWord(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  const bossPool = [
    ...new Set(
      options.words
        .filter(
          (word) =>
            word.length >= BALANCE.bossMinLen &&
            word.length <= BALANCE.bossMaxLen &&
            isTypeableWord(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  //no long words in the language: the boss falls back to the pool's longest
  const bossFallback =
    bossPool.length === 0
      ? [...pool].sort((a, b) => b.length - a.length)[0]
      : undefined;

  function pickWord(list: string[]): string {
    const index = Math.floor(options.rng() * list.length);
    return list[index] ?? list[0] ?? "type";
  }

  return {
    spawnWave(wave: number): WaveSpawn[] {
      const count = waveShipCount(wave);
      const speedBase =
        BALANCE.baseSpeedVhPerSec +
        (Math.max(wave, 1) - 1) * BALANCE.speedPerWaveVh;
      const spawns: WaveSpawn[] = [];
      for (let i = 0; i < count; i++) {
        spawns.push({
          word: pickWord(pool),
          speed: speedBase + options.rng() * BALANCE.speedJitterVh,
          isBoss: false,
        });
      }
      if (wave % BALANCE.bossEveryWaves === 0) {
        const bossWord =
          bossPool.length > 0
            ? pickWord(bossPool)
            : (bossFallback ?? "administer");
        const last = spawns.length - 1;
        if (last >= 0) {
          spawns[last] = {
            word: bossWord,
            speed:
              (speedBase + options.rng() * BALANCE.speedJitterVh) *
              BALANCE.bossSpeedMult,
            isBoss: true,
          };
        }
      }
      return spawns;
    },
  };
}
