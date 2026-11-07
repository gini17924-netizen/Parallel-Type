import { BALANCE, stageBaseSpeedOf } from "./balance";

/**
 * Balloon spawner (idea G6, phase 1): PURE — the caller injects the allowed
 * letters (learn-stats groups x unlockedGroups), the word pool (the current
 * language list) and the optional weakness map (idea #7's model, when it
 * has evidence). Randomness comes from the injected rng.
 *
 * Weighting: letters weigh `weakness[c]?.score ?? 1` — a weak letter is
 * proportionally more likely (the doc's P(letter) ∝ weakness); without a
 * weakness map the distribution is uniform over the unlocked letters.
 * Words weigh zipf-lite (shorter = more likely), mirroring the doc's
 * "wordset.randomWord('zipf')" intent.
 */

export type SpawnedBalloon = {
  payload: string;
  /** rising speed in vh per second */
  speed: number;
};

export type Spawner = {
  nextSpawn(): SpawnedBalloon;
};

function weightedPick(
  entries: { item: string; weight: number }[],
  rng: () => number,
): string {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return entries[entries.length - 1]?.item ?? "";
}

/** zipf-lite: shorter words are proportionally more likely */
function zipfLitePick(words: string[], rng: () => number): string {
  const entries = words.map((word) => ({
    item: word,
    weight: 1 / Math.max(1, word.length),
  }));
  return weightedPick(entries, rng);
}

export function createSpawner(options: {
  stage: number;
  level: number;
  /** the unlocked letters of the current language (already filtered) */
  letters: string[];
  /** the language's word pool (the engine applies the stage's length rules) */
  words: string[];
  /** idea #7's weakness map, when it has evidence; keys are letters */
  weakness?: Record<string, { score: number }>;
  rng: () => number;
}): Spawner {
  const stage = Math.min(Math.max(options.stage, 1), 4) as 1 | 2 | 3 | 4;
  const speed =
    stageBaseSpeedOf(stage) + options.level * BALANCE.levelSpeedStep;

  return {
    nextSpawn(): SpawnedBalloon {
      const rng = options.rng;

      if (stage === 1) {
        const entries = options.letters.map((letter) => ({
          item: letter,
          weight: options.weakness?.[letter]?.score ?? 1,
        }));
        return { payload: weightedPick(entries, rng), speed };
      }

      const shortWords = options.words.filter(
        (word) => word.length >= 3 && word.length <= 4,
      );
      const fullWords = options.words.filter(
        (word) => word.length >= 3 && word.length <= 8,
      );

      if (stage === 2) {
        //letters and 3-4 letter words alternate by chance
        if (rng() < BALANCE.stage2LetterChance) {
          const entries = options.letters.map((letter) => ({
            item: letter,
            weight: options.weakness?.[letter]?.score ?? 1,
          }));
          return { payload: weightedPick(entries, rng), speed };
        }
        return {
          payload: zipfLitePick(
            shortWords.length > 0
              ? shortWords
              : fullWords.length > 0
                ? fullWords
                : options.letters,
            rng,
          ),
          speed,
        };
      }

      if (stage === 3) {
        return {
          payload: zipfLitePick(
            fullWords.length > 0 ? fullWords : options.letters,
            rng,
          ),
          speed,
        };
      }

      //stage 4: plain words, punctuated words and 4-digit numbers
      const roll = rng();
      if (roll < BALANCE.stage4NumberChance) {
        const number = String(1000 + Math.floor(rng() * 9000));
        return { payload: number, speed };
      }
      const word = zipfLitePick(
        fullWords.length > 0 ? fullWords : options.letters,
        rng,
      );
      if (roll < BALANCE.stage4NumberChance + BALANCE.stage4PunctChance) {
        const punct =
          BALANCE.stage4PunctChars[
            Math.floor(rng() * BALANCE.stage4PunctChars.length)
          ] ?? "،";
        return { payload: word + punct, speed };
      }
      return { payload: word, speed };
    },
  };
}
