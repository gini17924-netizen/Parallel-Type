import { isInside, keyOf, type Point } from "./grid";

/**
 * Type Snake steering (idea G11, phase 1): the snake auto-walks toward
 * the food — one grid step per tick along the Manhattan route with a
 * FIXED tiebreak (dx before dy, doc G11 §۰.۲), refusing walls/body. When
 * every route step is blocked, the survival fallback picks the neighbor
 * with the most free neighbors ("گام به سمت فضای باز بیشتر"); when even
 * that fails the snake has nowhere to go (undefined = death).
 * PURE.
 */

export function nextCell(
  from: Point,
  target: Point,
  blocked: Set<string>,
  cols: number,
  rows: number,
): Point | undefined {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const routeSteps: Point[] = [];
  if (dx !== 0) routeSteps.push({ x: from.x + Math.sign(dx), y: from.y });
  if (dy !== 0) routeSteps.push({ x: from.x, y: from.y + Math.sign(dy) });
  for (const step of routeSteps) {
    if (isInside(cols, rows, step) && !blocked.has(keyOf(step))) return step;
  }
  return survivalFallback(from, blocked, cols, rows);
}

/** the most open adjacent cell (most free neighbors) — any direction */
function survivalFallback(
  from: Point,
  blocked: Set<string>,
  cols: number,
  rows: number,
): Point | undefined {
  const candidates: Point[] = [
    { x: from.x + 1, y: from.y },
    { x: from.x - 1, y: from.y },
    { x: from.x, y: from.y + 1 },
    { x: from.x, y: from.y - 1 },
  ].filter((p) => isInside(cols, rows, p) && !blocked.has(keyOf(p)));
  if (candidates.length === 0) return undefined;
  let best = candidates[0];
  let bestFree = -1;
  for (const candidate of candidates) {
    const free = [
      { x: candidate.x + 1, y: candidate.y },
      { x: candidate.x - 1, y: candidate.y },
      { x: candidate.x, y: candidate.y + 1 },
      { x: candidate.x, y: candidate.y - 1 },
    ].filter((p) => isInside(cols, rows, p) && !blocked.has(keyOf(p))).length;
    if (free > bestFree) {
      bestFree = free;
      best = candidate;
    }
  }
  return best;
}
