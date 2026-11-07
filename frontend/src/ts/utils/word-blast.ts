/**
 * Word Blast difficulty logic (pure, spec-tested — the GamesPage consumes it).
 */

export type Difficulty = "easy" | "normal" | "hard";

/** falling speed multiplier */
export const DIFFICULTY_SPEED: Record<Difficulty, number> = {
  easy: 0.75,
  normal: 1,
  hard: 1.35,
};

/** spawn interval multiplier (higher = words come slower) */
export const DIFFICULTY_SPAWN: Record<Difficulty, number> = {
  easy: 1.4,
  normal: 1,
  hard: 0.8,
};

/** chance that a spawned target is a multi-word phrase */
const PHRASE_CHANCE: Record<Difficulty, number> = {
  easy: 0,
  normal: 0.12,
  hard: 0.25,
};

/** words per phrase, by difficulty */
const PHRASE_WORDS: Record<Difficulty, number> = {
  easy: 2,
  normal: 2,
  hard: 3,
};

/** length window of single words, by difficulty */
const LENGTH_WINDOW: Record<Difficulty, [number, number]> = {
  easy: [3, 5],
  normal: [4, 8],
  hard: [5, 10],
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "easy",
  normal: "normal",
  hard: "hard",
};

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

export type WordPools = {
  wordPool: string[];
  phrasePool: string[];
};

/**
 * Builds the spawn pools for a difficulty from the language word list:
 * single words by length window, plus pre-built multi-word phrases
 * (2–3 short words joined by spaces) for the higher difficulties.
 */
export function buildWordPools(
  allWords: string[],
  difficulty: Difficulty,
): WordPools {
  const [min, max] = LENGTH_WINDOW[difficulty];
  const wordPool = allWords.filter(
    (word) => word.length >= min && word.length <= max,
  );

  const shortWords = allWords.filter(
    (word) => word.length >= 3 && word.length <= 6,
  );
  const phrasePool: string[] = [];
  if (difficulty === "easy" || shortWords.length < 2) {
    return { wordPool, phrasePool };
  }
  const phraseCount = difficulty === "hard" ? 24 : 12;
  for (let i = 0; i < phraseCount; i++) {
    const parts: string[] = [];
    for (let p = 0; p < PHRASE_WORDS[difficulty]; p++) {
      parts.push(
        shortWords[Math.floor(Math.random() * shortWords.length)] ?? "",
      );
    }
    const phrase = parts.join(" ").trim();
    if (phrase.includes(" ")) phrasePool.push(phrase);
  }

  return { wordPool, phrasePool };
}

/** picks the next falling target: mostly single words, sometimes a phrase */
export function pickTarget(
  pools: WordPools,
  difficulty: Difficulty,
): string | undefined {
  if (
    pools.phrasePool.length > 0 &&
    pools.wordPool.length > 0 &&
    Math.random() < PHRASE_CHANCE[difficulty]
  ) {
    return pools.phrasePool[
      Math.floor(Math.random() * pools.phrasePool.length)
    ];
  }
  const pool = pools.wordPool.length > 0 ? pools.wordPool : pools.phrasePool;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** falling speed of one word, in vh/tick, scaled by level and difficulty */
export function spawnSpeed(level: number, difficulty: Difficulty): number {
  return (
    (0.06 + level * 0.02 + Math.random() * 0.04) * DIFFICULTY_SPEED[difficulty]
  );
}

/** interval (ms) between spawns, scaled by level and difficulty */
export function spawnIntervalMs(level: number, difficulty: Difficulty): number {
  return Math.max(900, (3500 - level * 250) * DIFFICULTY_SPAWN[difficulty]);
}

// ---------------------------------------------------------------------------
// Word Blast v2 (idea G1): combo, boss, heart and the level fix. Every
// tunable of the new mechanics lives in BALANCE — the GamesPage consumes
// these instead of hardcoding numbers.
// ---------------------------------------------------------------------------

export const BALANCE = {
  /** combo streak tiers: the highest tier whose `n` <= the streak wins */
  comboTiers: [
    { n: 0, m: 1 },
    { n: 5, m: 1.5 },
    { n: 10, m: 2 },
    { n: 20, m: 3 },
  ],
  /** a wrong key on the current word breaks the combo (accuracy > speed) */
  comboBreakOnWrongKey: true,
  /** boss word: guaranteed once per level-up, worth ×5, falls slower */
  bossScoreMult: 5,
  bossSpeedMult: 0.6,
  /** a heart word may spawn on every Nth spawn with this chance (+1 life) */
  heartEveryNSpawns: 40,
  heartChance: 0.35,
  maxLives: 5,
  /** points per level (level = floor(score / levelStep) + 1) */
  levelStep: 500,
} as const;

/** the multiplier of the combo streak's active tier */
export function comboMult(combo: number): number {
  let mult = 1;
  for (const tier of BALANCE.comboTiers) {
    if (combo >= tier.n) mult = tier.m;
  }
  return mult;
}

/**
 * v2 level derivation: every levelStep points is a level. Replaces the old
 * `score % 500 === 0` check that only fired on exact multiples (a word worth
 * 20 could jump straight past 500 without a level-up).
 */
export function levelForScore(score: number): number {
  return Math.floor(score / BALANCE.levelStep) + 1;
}

/**
 * The boss word of a level-up: the longest phrase of the pool; on easy
 * (which builds no phrases) the longest single word. undefined when both
 * pools are empty.
 */
export function pickBossWord(pools: WordPools): string | undefined {
  const longest = (list: string[]): string | undefined =>
    list.reduce<string | undefined>(
      (best, word) =>
        best === undefined || word.length > best.length ? word : best,
      undefined,
    );
  return longest(pools.phrasePool) ?? longest(pools.wordPool);
}

/**
 * A heart word may appear on every Nth spawn with heartChance. The roll
 * comes from the injected rng so tests are deterministic; only the multiples
 * of heartEveryNSpawns consume a roll.
 */
export function shouldSpawnHeart(
  spawnCount: number,
  rng: () => number,
): boolean {
  if (spawnCount <= 0 || spawnCount % BALANCE.heartEveryNSpawns !== 0) {
    return false;
  }
  return rng() < BALANCE.heartChance;
}
