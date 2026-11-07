import { BALANCE } from "./balance";

/**
 * Crane Stack engine (idea G17, phase 1): the crane sweeps horizontally
 * (ping-pong at the edges) carrying a key sequence; the player types the
 * sequence (a wrong key resets the partial — the TIMING penalty is the
 * challenge); completing it releases the box. The quality = the
 * horizontal distance from the zone center at the release moment:
 * Perfect (±4%) → 300, Good (±10%) → 150, Poor (±20%) → 50, Miss → the
 * misses counter (3 = the run is over). The zone shifts per level and
 * the crane speeds up.
 *
 * PURE: the injected seqFor callback supplies the key sequences; the rng
 * is injected for the zone shifts.
 */

export type CranePhase = "running" | "done";

export type CraneQuality = "perfect" | "good" | "poor" | "miss";

export type CraneResult = {
  score: number;
  height: number;
  perfectCount: number;
  misses: number;
};

export type CraneState = {
  phase: CranePhase;
  craneX: number;
  sequence: string[];
  typed: number;
  zoneCenter: number;
  score: number;
  height: number;
  level: number;
  perfectCount: number;
  misses: number;
  lastQuality: CraneQuality | undefined;
  result: CraneResult | undefined;
};

export type CraneEngine = {
  state(): CraneState;
  /** the crane sweep (ping-pong at the edges) */
  tick(dtMs: number): CraneState;
  /** a key against the sequence; completing releases the box */
  feedKey(key: string): CraneState;
  /** test hook: parks the crane at an exact x (repo convention) */
  _setCraneXForTests(x: number): void;
};

export function createCraneEngine(options: {
  /** supplies the next key sequence for a level */
  seqFor: (level: number) => string[];
  rng: () => number;
  /** the initial zone center (default 50) */
  zoneCenter?: number;
}): CraneEngine {
  let phase: CranePhase = "running";
  let craneX = 50;
  let direction = 1;
  let zoneCenter = options.zoneCenter ?? 50;
  let height = 0;
  let score = 0;
  let perfectCount = 0;
  let perfectStreak = 0;
  let misses = 0;
  let level = 1;
  let sequence = options.seqFor(level);
  let typed = 0;
  let lastQuality: CraneQuality | undefined;

  function craneSpeed(): number {
    return BALANCE.craneSpeedStart + (level - 1) * BALANCE.craneSpeedPerLevel;
  }

  function tick(dtMs: number): CraneState {
    if (phase !== "running") return snapshot();
    const seconds = dtMs / 1000;
    craneX += direction * craneSpeed() * seconds;
    if (craneX >= 100) {
      craneX = 100;
      direction = -1;
    } else if (craneX <= 0) {
      craneX = 0;
      direction = 1;
    }
    return snapshot();
  }

  function release(): CraneQuality {
    const dist = Math.abs(craneX - zoneCenter);
    if (dist <= BALANCE.perfectPct) return "perfect";
    if (dist <= BALANCE.goodPct) return "good";
    if (dist <= BALANCE.poorPct) return "poor";
    return "miss";
  }

  function applyQuality(quality: CraneQuality): void {
    lastQuality = quality;
    switch (quality) {
      case "perfect":
        perfectCount += 1;
        perfectStreak += 1;
        score += BALANCE.perfectScore;
        if (perfectStreak >= 2) score += BALANCE.perfectStreakBonus;
        break;
      case "good":
        perfectStreak = 0;
        score += BALANCE.goodScore;
        break;
      case "poor":
        perfectStreak = 0;
        score += BALANCE.poorScore;
        break;
      case "miss":
        perfectStreak = 0;
        misses += 1;
        break;
    }
  }

  function nextFloor(): void {
    height += 1;
    level = 1 + Math.floor(height / BALANCE.floorsPerLevel);
    //the zone shifts per level (seed-adjacent)
    zoneCenter = Math.max(
      20,
      Math.min(80, zoneCenter + (options.rng() * 2 - 1) * BALANCE.zoneShiftPct),
    );
    sequence = options.seqFor(level);
    typed = 0;
  }

  function snapshot(): CraneState {
    return {
      phase,
      craneX,
      sequence: [...sequence],
      typed,
      zoneCenter,
      score,
      height,
      level,
      perfectCount,
      misses,
      lastQuality,
      result:
        phase === "done" ? { score, height, perfectCount, misses } : undefined,
    };
  }

  return {
    state: () => snapshot(),
    tick,
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (key.length !== 1) return snapshot();
      const ch = key.toLowerCase();
      const expected = sequence[typed]?.toLowerCase();
      if (expected !== ch) {
        typed = 0; //a wrong key resets the partial (doc G17 §۰.۳)
        return snapshot();
      }
      typed += 1;
      if (typed >= sequence.length) {
        const quality = release();
        applyQuality(quality);
        if (misses >= BALANCE.maxMisses) {
          phase = "done";
          return snapshot();
        }
        //the base rises only on a SUCCESSFUL box (doc G17 §۰.۳: Miss =
        //the box falls outside, no floor is gained)
        if (quality !== "miss") {
          nextFloor();
        } else {
          sequence = options.seqFor(level);
          typed = 0;
        }
      }
      return snapshot();
    },
    _setCraneXForTests(x: number) {
      craneX = Math.max(0, Math.min(100, x));
    },
  };
}
