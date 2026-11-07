/**
 * The Daily Gauntlet registry (idea G22, phase 1): the shared contract
 * every game implements to join the daily challenge (doc §۱ — the
 * architecture core). A game registers a small wrapper that can run ONE
 * seeded stage full-page and resolve a Promise with its normalized
 * result. Registration is idempotent-hostile: a double registration
 * throws (a fork bug, not a runtime condition). PURE — no game imports
 * live here; the wrappers register themselves from their own modules.
 */

/** one day's stage for one game: a locked seed + the day's parameters */
export type DailyStage = {
  /** "word-blast" | "sprint" | "bot-duel" | … (the registry's gameIds) */
  gameId: string;
  title: string;
  /** derived from hash(dayKey + gameId) — the whole run is replayable */
  seed: number;
  /** the per-game day parameters (each game documents its own shape) */
  params: Record<string, unknown>;
};

export type DailyStageResult = {
  gameId: string;
  /** the per-game normalizer's 0..1000 output */
  normalized: number;
  /** the game's own raw numbers (for the summary + debugging) */
  raw: Record<string, number | boolean | string>;
  won: boolean;
};

export type DailyPlayable = {
  gameId: string;
  /** runs one stage full-page (the game brings its own UI) and
   * resolves when the stage is over */
  runDailyStage(stage: DailyStage): Promise<DailyStageResult>;
};

const registry = new Map<string, DailyPlayable>();

/** registers a game's daily wrapper — a double registration throws */
export function registerDailyPlayable(impl: DailyPlayable): void {
  if (registry.has(impl.gameId)) {
    throw new Error(`daily playable already registered: ${impl.gameId}`);
  }
  registry.set(impl.gameId, impl);
}

export function getDailyPlayable(gameId: string): DailyPlayable | undefined {
  return registry.get(gameId);
}

/** the registered games in registration order (compose consumes this) */
export function listDailyPlayables(): DailyPlayable[] {
  return [...registry.values()];
}

/** test hook: empties the registry */
export function _resetDailyRegistryForTests(): void {
  registry.clear();
}
