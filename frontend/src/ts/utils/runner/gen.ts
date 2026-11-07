import { BALANCE } from "./balance";

/**
 * Endless Runner obstacle generator (idea G15, phase 1 — mode B): three
 * kinds with direction icons — jump (ground), slide (air), destroy
 * (drone) — shrinking gaps with speed and a hard minimum (doc §۰.B.۲).
 * The WORD SOURCE is injected; PURE: rng injected.
 */

export type ObstacleKind = "jump" | "slide" | "destroy";

export type Obstacle = {
  id: number;
  kind: ObstacleKind;
  word: string;
  /** the gap BEFORE this obstacle (px of clear ground after the previous) */
  gapPx: number;
};

export const KINDS: ObstacleKind[] = ["jump", "slide", "destroy"];

export function kindIcon(kind: ObstacleKind): string {
  switch (kind) {
    case "jump":
      return "↑";
    case "slide":
      return "↓";
    case "destroy":
      return "✕";
  }
}

/** the word cap shrinks as the speed rises (doc §۰.B.۲) */
export function wordLenMax(speedPxPerS: number): number {
  const span = BALANCE.speedMaxPxPerS - BALANCE.speedStartPxPerS;
  if (span <= 0) return BALANCE.wordLenMaxStart;
  const progress = Math.max(
    0,
    Math.min(1, (speedPxPerS - BALANCE.speedStartPxPerS) / span),
  );
  return Math.round(
    BALANCE.wordLenMaxStart -
      progress * (BALANCE.wordLenMaxStart - BALANCE.wordLenMaxMin),
  );
}

export function nextObstacle(options: {
  id: number;
  index: number;
  speedPxPerS: number;
  rng: () => number;
  pickWord: (minLen: number, maxLen: number) => string;
}): Obstacle {
  const kind =
    KINDS[Math.floor(options.rng() * KINDS.length) % KINDS.length] ?? "jump";
  const maxLen = Math.max(BALANCE.wordLenMin, wordLenMax(options.speedPxPerS));
  const word = options.pickWord(BALANCE.wordLenMin, maxLen);
  const gapPx = Math.max(
    BALANCE.gapMinPx,
    BALANCE.gapStartPx - options.index * BALANCE.gapDecayPxPerObstacle,
  );
  return { id: options.id, kind, word, gapPx };
}
