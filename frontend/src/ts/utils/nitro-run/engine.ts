import { BALANCE, aiSpeedMps, checkpointMult } from "./balance";
import {
  aiAdvance,
  checkpointsFor,
  createAiRacer,
  type AiRacer,
} from "./racers";

/**
 * Nitro Run engine (idea G23, phase 1): an endless race — the player's
 * progress is TYPING-driven (completed words only; time never moves the
 * player), the AI race on time with checkpoint scaling. A wrong key
 * spins the player out for 0.5s (typing inert) and breaks the combo; a
 * 5-correct-word streak banks a nitro charge (cap 3) and Enter burns
 * one for 3 seconds of x2 progress; falling behind the NEAREST AI by
 * more than the gap distance ends the run with a rank.
 *
 * PURE: the injected nextWord callback supplies the stream; the tick
 * drives the AI and the timers (spin-out, nitro, gap check).
 */

export type NitroRunPhase = "running" | "done";

export type NitroRunResult = {
  rank: number;
  rankScore: number;
  distanceM: number;
  perfectWords: number;
  maxCombo: number;
  nitroUses: number;
  racerCount: number;
};

export type NitroRunState = {
  phase: NitroRunPhase;
  distanceM: number;
  ai: { lane: number; progressM: number }[];
  currentWord: string;
  typed: number;
  combo: number;
  maxCombo: number;
  streak: number;
  perfectWords: number;
  nitroCharges: number;
  nitroActiveMs: number;
  spinOutMs: number;
  elapsedMs: number;
  rank: number | undefined;
  result: NitroRunResult | undefined;
};

export type NitroRunEngine = {
  state(): NitroRunState;
  /** drives the AI, the spin-out/nitro timers and the gap check */
  tick(dtMs: number): NitroRunState;
  /** a letter against the current word, or Enter to burn a nitro */
  feedKey(key: string): NitroRunState;
};

export function createNitroRunEngine(options: {
  nextWord: () => string;
  /** the AI field's wpm bases (fixed per racer, different speeds) */
  aiWpms?: number[];
  rng?: () => number;
}): NitroRunEngine {
  const rng = options.rng ?? (() => 0.5);
  const aiWpms = options.aiWpms ?? BALANCE.aiWpms;
  let phase: NitroRunPhase = "running";
  let playerProgressM = 0;
  let elapsedMs = 0;
  let combo = 0;
  let maxCombo = 0;
  let streak = 0;
  let perfectWords = 0;
  let nitroCharges = 0;
  let nitroRemainingMs = 0;
  let nitroUses = 0;
  let spinOutRemainingMs = 0;
  let currentWord = options.nextWord();
  let typed = 0;
  let wordHadError = false;
  let rank: number | undefined;

  const ais: AiRacer[] = aiWpms.map((wpmBase, index) =>
    createAiRacer({
      wpmBase,
      lane: index % BALANCE.aiCount,
    }),
  );
  void rng;

  function snapshot(): NitroRunState {
    return {
      phase,
      distanceM: playerProgressM,
      ai: ais.map((racer) => ({
        lane: racer.lane,
        progressM: racer.progressM,
      })),
      currentWord,
      typed,
      combo,
      maxCombo,
      streak,
      perfectWords,
      nitroCharges,
      nitroActiveMs: nitroRemainingMs,
      spinOutMs: spinOutRemainingMs,
      elapsedMs,
      rank,
      result:
        phase === "done" && rank !== undefined
          ? {
              rank,
              rankScore:
                (ais.length + 1 - rank + 1) * BALANCE.rankPlaceScore +
                playerProgressM * BALANCE.rankDistanceMult +
                perfectWords * BALANCE.rankPerfectScore,
              distanceM: playerProgressM,
              perfectWords,
              maxCombo,
              nitroUses,
              racerCount: ais.length + 1,
            }
          : undefined,
    };
  }

  function finish(): NitroRunState {
    phase = "done";
    //the player's place: behind every AI that is ahead
    rank = 1 + ais.filter((racer) => racer.progressM > playerProgressM).length;
    return snapshot();
  }

  function completeWord(): void {
    const len = currentWord.length;
    const mult = nitroRemainingMs > 0 ? BALANCE.nitroProgressMult : 1;
    playerProgressM += len * BALANCE.progressPerCharM * mult;
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    streak += 1;
    if (!wordHadError) perfectWords += 1;
    if (streak % BALANCE.nitroStreakWords === 0) {
      nitroCharges = Math.min(BALANCE.nitroChargesMax, nitroCharges + 1);
    }
    currentWord = options.nextWord();
    typed = 0;
    wordHadError = false;
  }

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running") return snapshot();
      elapsedMs += dtMs;
      //the AI race on time, scaling with the race's checkpoints
      const checkpoints = checkpointsFor(
        playerProgressM,
        BALANCE.checkpointEveryM,
      );
      for (const racer of ais) {
        aiAdvance(racer, dtMs / 1000, checkpoints);
      }
      //the timers
      if (spinOutRemainingMs > 0) {
        spinOutRemainingMs = Math.max(0, spinOutRemainingMs - dtMs);
      }
      if (nitroRemainingMs > 0) {
        nitroRemainingMs = Math.max(0, nitroRemainingMs - dtMs);
      }
      //the loss: hopelessly behind the NEAREST AI (doc G23 §۰.۴)
      const nearestAi = ais.reduce(
        (min, racer) => Math.min(min, racer.progressM),
        Number.POSITIVE_INFINITY,
      );
      if (nearestAi - playerProgressM > BALANCE.gapLossM) {
        return finish();
      }
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (key === "Enter") {
        //nitro: burns one charge for 3s of x2 progress
        if (nitroCharges > 0 && nitroRemainingMs === 0) {
          nitroCharges -= 1;
          nitroUses += 1;
          nitroRemainingMs = BALANCE.nitroDurationMs;
        }
        return snapshot();
      }
      if (key.length !== 1) return snapshot();
      if (spinOutRemainingMs > 0) return snapshot(); //spinning: inert
      const ch = key.toLowerCase();
      const expected = currentWord[typed]?.toLowerCase();
      if (expected !== ch) {
        //a wrong key: the spin-out + the combo breaks (doc G23 §۰.۱)
        spinOutRemainingMs = BALANCE.spinOutMs;
        combo = 0;
        wordHadError = true;
        return snapshot();
      }
      typed += 1;
      if (typed >= currentWord.length) completeWord();
      return snapshot();
    },
  };
}

/** exposed for the page's HUD math: the AI pace in m/s for a wpm */
export { aiSpeedMps, checkpointMult };
