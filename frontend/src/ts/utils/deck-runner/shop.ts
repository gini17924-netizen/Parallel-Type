import {
  costAfterDiscount,
  duplicateAllowed,
  jokerIsAvailable,
  JOKER_REGISTRY,
  type Rarity,
} from "./cards";
import { createRng, deriveSeed } from "./rng";
import type { DeckRunState } from "./run-engine";

/**
 * Deck Runner shop & reward offers (idea G24, phase 2). Deterministic per
 * position: offers derive from LCG(seed ^ mix(ante, blindIndex, rerolls)),
 * so a resumed run sees the same shop it left.
 *
 * Rarity curve per ante: ante 1 is common-heavy; later antes weight
 * rare/legendary up. The reward pick (1-of-3 after each won blind)
 * guarantees exactly one common.
 */

const RARITY_WEIGHT: Record<Rarity, [number, number]> = {
  //[ante 1 weight, ante >= 2 weight]
  common: [62, 46],
  rare: [28, 36],
  legendary: [10, 18],
};

export type ShopOffer = { jokerId: string; cost: number };

function registryPool(options: {
  owned: string[];
  hasWeakness: boolean;
}): string[] {
  const owned = new Set(options.owned);
  return Object.keys(JOKER_REGISTRY).filter((id) => {
    if (!jokerIsAvailable(id, options.hasWeakness)) return false;
    if (owned.has(id) && !duplicateAllowed(id)) return false;
    return true;
  });
}

function pickWeightedRarity(ante: number, rng: () => number): Rarity {
  const column = ante >= 2 ? 1 : 0;
  const total =
    RARITY_WEIGHT.common[column] +
    RARITY_WEIGHT.rare[column] +
    RARITY_WEIGHT.legendary[column];
  let roll = rng() * total;
  for (const rarity of ["common", "rare", "legendary"] as Rarity[]) {
    roll -= RARITY_WEIGHT[rarity][column];
    if (roll <= 0) return rarity;
  }
  return "common";
}

function pickFromRarity(
  pool: string[],
  rarity: Rarity,
  rng: () => number,
): string | undefined {
  const matches = pool.filter((id) => JOKER_REGISTRY[id]?.rarity === rarity);
  if (matches.length === 0) return undefined;
  return matches[Math.floor(rng() * matches.length) % matches.length];
}

/** the 3-4 buyable jokers of the shop after a blind */
export function shopOffers(
  state: DeckRunState,
  runtime: { shopDiscount: number },
  hasWeakness: boolean,
): ShopOffer[] {
  const rng = createRng(
    deriveSeed(
      state.seed,
      `shop:${state.ante}:${state.blindIndex}:${state.rerolls}`,
    ),
  );
  const pool = registryPool({ owned: state.jokers, hasWeakness });
  const count = state.ante >= 2 ? 4 : 3;
  const offers: ShopOffer[] = [];
  for (let i = 0; i < count; i++) {
    const rarity = pickWeightedRarity(state.ante, rng);
    const picked =
      pickFromRarity(pool, rarity, rng) ??
      pickFromRarity(pool, "common", rng) ??
      pool[0];
    if (picked === undefined) break;
    const def = JOKER_REGISTRY[picked];
    if (def === undefined) continue;
    offers.push({
      jokerId: picked,
      cost: costAfterDiscount(def, runtime.shopDiscount),
    });
  }
  return offers;
}

/** the 1-of-3 reward pick after a won blind: exactly one guaranteed common */
export function rewardOffers(
  state: DeckRunState,
  hasWeakness: boolean,
): string[] {
  const rng = createRng(
    deriveSeed(state.seed, `reward:${state.ante}:${state.blindIndex}`),
  );
  const pool = registryPool({ owned: state.jokers, hasWeakness });
  const picks: string[] = [];
  const take = (id: string | undefined): void => {
    if (id === undefined) return;
    if (picks.includes(id)) return;
    picks.push(id);
  };
  take(pickFromRarity(pool, "common", rng));
  while (picks.length < 3) {
    const rarity = pickWeightedRarity(state.ante, rng);
    const before = picks.length;
    take(pickFromRarity(pool, rarity, rng));
    take(pickFromRarity(pool, "common", rng));
    if (picks.length === before) break; //pool exhausted
  }
  return picks;
}
