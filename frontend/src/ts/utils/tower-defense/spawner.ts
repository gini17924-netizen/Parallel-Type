import { BALANCE, waveEnemyCount } from "./balance";

/**
 * Tower Defense wave spawner (phase 85): builds one wave's enemy spawns.
 * PURE: the rng is injected — the LAN mode derives it from the shared
 * match seed, so both machines see the identical waves (words, speeds,
 * lanes, tanks in the identical order).
 */

export type TowerRng = () => number;

export type EnemySpawn = {
  word: string;
  speed: number;
  lane: number;
  isTank: boolean;
};

export type WaveSpawner = {
  spawnWave: (wave: number) => EnemySpawn[];
};

function isTypable(word: string): boolean {
  return /^\p{L}+$/u.test(word);
}

export function createTowerWaveSpawner(options: {
  words: string[];
  rng: TowerRng;
}): WaveSpawner {
  const realPool = [
    ...new Set(
      options.words
        .filter(
          (word) =>
            word.length >= BALANCE.minWordLen &&
            word.length <= BALANCE.maxWordLen &&
            isTypable(word),
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
            isTypable(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  const enemyWord = (): string =>
    realPool[Math.floor(options.rng() * realPool.length)] ?? "type";
  const tankWord = (): string =>
    tankPool[Math.floor(options.rng() * tankPool.length)] ?? "defense";

  return {
    spawnWave(wave: number): EnemySpawn[] {
      const count = waveEnemyCount(wave);
      const speedBase =
        BALANCE.baseSpeedVhPerSec +
        (Math.max(wave, 1) - 1) * BALANCE.speedPerWaveVh;
      const spawns: EnemySpawn[] = [];
      for (let i = 0; i < count; i++) {
        spawns.push({
          word: enemyWord(),
          speed: speedBase + options.rng() * BALANCE.speedJitterVh,
          lane: Math.floor(options.rng() * BALANCE.lanes),
          isTank: false,
        });
      }
      if (wave % BALANCE.tankEveryWaves === 0 && spawns.length > 0) {
        const last = spawns.length - 1;
        spawns[last] = {
          word: tankWord(),
          speed:
            (speedBase + options.rng() * BALANCE.speedJitterVh) *
            BALANCE.tankSpeedMult,
          lane: spawns[last]?.lane ?? 0,
          isTank: true,
        };
      }
      return spawns;
    },
  };
}
