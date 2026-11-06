import type { WeaknessMap } from "../weakness-model";

/**
 * Word source adapters for Deck Runner (idea G24). PURE: candidate pools are
 * injected by the caller (fetched lists / custom texts), randomness comes
 * from the injected rng stream.
 *
 * Kinds:
 * - "language"/"custom": uniform pick
 * - "zipf": Zipf inverse-CDF sampling mirroring utils/misc.ts
 *   zipfyRandomArrayIndex (Math.random mirrored to the injected rng, plus a
 *   clamp the upstream version lacks - its floor can reach `n`)
 * - "weakness": argmax-20 over mean letter weakness (weak-spot trick) on the
 *   idea #7 weakness map; silently uniform when no evidence
 *
 * Contracts: tokens carry no spaces; length window (ante-dependent); a
 * recent-window dedupe so the same word does not repeat within 10 picks.
 */

export type WordSourceKind = "language" | "zipf" | "custom" | "weakness";

export type WordSource = {
  id: string;
  nextWord(): string;
};

import {
  ARGMAX_SAMPLES,
  DEFAULT_MAX_LENGTH,
  DEFAULT_MIN_LENGTH,
  RECENT_WINDOW,
} from "./balance";

export { ARGMAX_SAMPLES, DEFAULT_MAX_LENGTH, DEFAULT_MIN_LENGTH };

export type WordSourceConfig = {
  id: string;
  kind: WordSourceKind;
  /** injected candidate pool (already fetched by the caller) */
  pool: string[];
  rng: () => number;
  minLength?: number;
  maxLength?: number;
  /** required for the "weakness" kind; ignored otherwise */
  weakness?: WeaknessMap;
};

export function normalizePool(
  pool: string[],
  minLength = DEFAULT_MIN_LENGTH,
  maxLength = DEFAULT_MAX_LENGTH,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pool) {
    const word = raw.trim();
    if (word.length < minLength || word.length > maxLength) continue;
    if (word.includes(" ")) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** Zipf inverse-CDF index, mirrored from zipfyRandomArrayIndex with an
 * injected rng and a bounds clamp (upstream floor can return `n`) */
function zipfIndex(length: number, rng: () => number): number {
  const gamma = 0.5772156649015329; // Euler–Mascheroni constant
  const harmonic = Math.log(length + 0.5) + gamma;
  const inverseCDF = Math.exp(rng() * harmonic - gamma) - 0.5;
  return Math.min(length - 1, Math.max(0, Math.floor(inverseCDF)));
}

export function createWordSource(config: WordSourceConfig): WordSource {
  const pool = normalizePool(
    config.pool,
    config.minLength ?? DEFAULT_MIN_LENGTH,
    config.maxLength ?? DEFAULT_MAX_LENGTH,
  );
  const recent: string[] = [];

  const remember = (word: string): void => {
    recent.push(word);
    if (recent.length > RECENT_WINDOW) recent.shift();
  };
  const isRecent = (word: string): boolean => recent.includes(word);

  const pickUniform = (): string => {
    for (let attempt = 0; attempt < RECENT_WINDOW; attempt++) {
      const word =
        pool[Math.floor(config.rng() * pool.length) % pool.length] ?? "";
      if (!isRecent(word)) {
        remember(word);
        return word;
      }
    }
    const word =
      pool[Math.floor(config.rng() * pool.length) % pool.length] ?? "";
    remember(word);
    return word;
  };

  const pickZipf = (): string => {
    for (let attempt = 0; attempt < RECENT_WINDOW; attempt++) {
      const index = zipfIndex(pool.length, config.rng);
      const word = pool[index] ?? "";
      if (!isRecent(word)) {
        remember(word);
        return word;
      }
    }
    const word = pool[zipfIndex(pool.length, config.rng)] ?? "";
    remember(word);
    return word;
  };

  const pickWeakness = (): string => {
    const weakness = config.weakness ?? {};
    if (Object.keys(weakness).length === 0) return pickUniform();
    let best = "";
    let bestScore = -1;
    let sampledAny = false;
    for (let i = 0; i < ARGMAX_SAMPLES; i++) {
      const word =
        pool[Math.floor(config.rng() * pool.length) % pool.length] ?? "";
      sampledAny = true;
      const known = [...word.toLowerCase()].filter(
        (ch) => weakness[ch] !== undefined,
      );
      const score =
        known.length === 0
          ? 0
          : known.reduce((sum, ch) => sum + (weakness[ch]?.score ?? 0), 0) /
            known.length;
      if (score > bestScore && !(isRecent(word) && sampledAny)) {
        best = word;
        bestScore = score;
      }
      void known;
    }
    if (best === "" && pool.length > 0) best = pool[0] ?? "";
    remember(best);
    return best;
  };

  const nextWord = (): string => {
    if (pool.length === 0) return "";
    switch (config.kind) {
      case "zipf":
        return pickZipf();
      case "weakness":
        return pickWeakness();
      default:
        return pickUniform();
    }
  };

  return { id: config.id, nextWord };
}
