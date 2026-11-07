/**
 * Type Snake grid (idea G11, phase 1): pure point/collision math for a
 * 24x18 wrap-off grid. A point key is "x,y" for Set-based blocked lookups.
 */

export type Point = { x: number; y: number };

export function keyOf(p: Point): string {
  return `${p.x},${p.y}`;
}

export function isInside(cols: number, rows: number, p: Point): boolean {
  return p.x >= 0 && p.x < cols && p.y >= 0 && p.y < rows;
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
