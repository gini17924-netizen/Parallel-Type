import { hashKey } from "./compose";

/**
 * phase 99: the shareable challenge code. a code is just a SEED with
 * clothes: buildDaily(code, playables) composes the exact same three-stage
 * gauntlet for everyone holding the code, so a friend can race the same
 * challenge without any server. the daily code derives deterministically
 * from the dayKey (everyone's TODAY code matches); a friend's code is any
 * normalized seed the page accepts.
 *
 * a loaded challenge runs in the SAME gauntlet slot with the dayKey
 * "challenge:<code>" — the slot frees on reload, the calendar and the
 * comparison board only ever aggregate the REAL day key, so a friendly
 * challenge can never contaminate the daily streak or the board.
 */

export const CHALLENGE_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

/** normalizes a typed code: uppercase, strip separators; undefined when
 * the remainder is not 4-16 A-Z0-9 characters */
export function normalizeChallengeCode(raw: string): string | undefined {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!CHALLENGE_CODE_PATTERN.test(cleaned)) return undefined;
  return cleaned;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; //no I/1, O/0

/** today's shareable code — deterministic under the day's hash, so every
 * friend that opens the same DAY sees the same code */
export function challengeCodeForDay(dayKey: string): string {
  let seed = hashKey(`challenge:${dayKey}`);
  let code = "";
  for (let i = 0; i < 6; i++) {
    seed = (seed * 16807) % 2147483647;
    code += CODE_ALPHABET[seed % CODE_ALPHABET.length];
  }
  return code;
}

/** the gauntlet slot's dayKey for a loaded challenge code */
export function challengeDayKey(code: string): string {
  return `challenge:${code}`;
}

/** reads a slot dayKey back into the code (undefined for real days) */
export function codeFromChallengeDayKey(dayKey: string): string | undefined {
  if (!dayKey.startsWith("challenge:")) return undefined;
  return normalizeChallengeCode(dayKey.slice("challenge:".length));
}
