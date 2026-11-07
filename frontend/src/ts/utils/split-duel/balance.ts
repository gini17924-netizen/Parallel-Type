/**
 * Split-Key Showdown balance (idea G19, phase 1): every tunable in one
 * file — the engine modules import from here; nothing else hardcodes.
 */

export const BALANCE = {
  /** the shared 3-2-1 countdown before both modes start */
  countdownMs: 3000,
  /** the default word stream length per player (doc §۰) */
  defaultWords: 20,
  /** the result's margin floor for a "close match" label */
  closeMarginMs: 500,
} as const;
