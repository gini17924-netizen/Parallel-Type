import { BALANCE } from "./balance";

/**
 * Maze Runner maze (idea G14, phase 1): the seeded recursive-backtracker
 * with optional braiding (doc §۲). Walls are stored canonically: `v[y][x]`
 * is the wall BETWEEN (x,y) and (x+1,y); `h[y][x]` is the wall BETWEEN
 * (x,y) and (x,y+1). The outer boundary is implicit. PURE: rng injected.
 */

export type Maze = {
  cols: number;
  rows: number;
  /** v[y][x] = the wall to the RIGHT of cell (x,y), x < cols-1 */
  v: boolean[][];
  /** h[y][x] = the wall BELOW cell (x,y), y < rows-1 */
  h: boolean[][];
};

export type Cell = { x: number; y: number };

export function mazeStart(): Cell {
  return { x: 0, y: 0 };
}

export function mazeExit(maze: Maze): Cell {
  return { x: maze.cols - 1, y: maze.rows - 1 };
}

/** the open neighbors of a cell (walls respected) */
export function neighbors(maze: Maze, cell: Cell): Cell[] {
  const out: Cell[] = [];
  const { x, y } = cell;
  if (x > 0 && maze.v[y]?.[x - 1] === false) out.push({ x: x - 1, y });
  if (x < maze.cols - 1 && maze.v[y]?.[x] === false) out.push({ x: x + 1, y });
  if (y > 0 && maze.h[y - 1]?.[x] === false) out.push({ x, y: y - 1 });
  if (y < maze.rows - 1 && maze.h[y]?.[x] === false) out.push({ x, y: y + 1 });
  return out;
}

/** the classic seeded recursive backtracker (iterative, doc §۲) */
export function generateMaze(
  cols: number,
  rows: number,
  rng: () => number,
  braidChance: number = BALANCE.braidChance,
): Maze {
  const v: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: Math.max(0, cols - 1) }, () => true),
  );
  const h: boolean[][] = Array.from({ length: Math.max(0, rows - 1) }, () =>
    Array.from({ length: cols }, () => true),
  );
  const visited = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false),
  );
  const stack: Cell[] = [{ x: 0, y: 0 }];
  visited[0]?.splice(0, 1, true);
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    if (current === undefined) break;
    const candidates: Cell[] = [];
    const { x, y } = current;
    if (x > 0 && visited[y]?.[x - 1] === false) {
      candidates.push({ x: x - 1, y });
    }
    if (x < cols - 1 && visited[y]?.[x + 1] === false) {
      candidates.push({ x: x + 1, y });
    }
    if (y > 0 && visited[y - 1]?.[x] === false) {
      candidates.push({ x, y: y - 1 });
    }
    if (y < rows - 1 && visited[y + 1]?.[x] === false) {
      candidates.push({ x, y: y + 1 });
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const next =
      candidates[Math.floor(rng() * candidates.length) % candidates.length];
    if (next === undefined) break;
    //carve the wall between current and next
    if (next.x === x + 1) v[y]?.splice(x, 1, false);
    else if (next.x === x - 1) v[y]?.splice(next.x, 1, false);
    else if (next.y === y + 1) h[y]?.splice(x, 1, false);
    else if (next.y === y - 1) h[next.y]?.splice(x, 1, false);
    visited[next.y]?.splice(next.x, 1, true);
    stack.push(next);
  }
  const maze: Maze = { cols, rows, v, h };
  braid(maze, rng, braidChance);
  return maze;
}

/** opens one extra wall per dead-end with the given chance (loops) */
function braid(maze: Maze, rng: () => number, chance: number): void {
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (rng() > chance) continue;
      const open = neighbors(maze, { x, y });
      if (open.length >= 3) continue; //not a dead-end
      //closeable candidates: walls toward in-bounds neighbors
      const closed: { a: Cell; b: Cell }[] = [];
      if (x > 0 && maze.v[y]?.[x - 1] === true) {
        closed.push({ a: { x, y }, b: { x: x - 1, y } });
      }
      if (x < maze.cols - 1 && maze.v[y]?.[x] === true) {
        closed.push({ a: { x, y }, b: { x: x + 1, y } });
      }
      if (y > 0 && maze.h[y - 1]?.[x] === true) {
        closed.push({ a: { x, y }, b: { x, y: y - 1 } });
      }
      if (y < maze.rows - 1 && maze.h[y]?.[x] === true) {
        closed.push({ a: { x, y }, b: { x, y: y + 1 } });
      }
      const pick = closed[Math.floor(rng() * closed.length) % closed.length];
      if (pick === undefined) continue;
      openWall(maze, pick.a, pick.b);
    }
  }
}

export function openWall(maze: Maze, a: Cell, b: Cell): void {
  if (a.y === b.y && b.x === a.x + 1) maze.v[a.y]?.splice(a.x, 1, false);
  else if (b.y === a.y && a.x === b.x + 1) maze.v[b.y]?.splice(b.x, 1, false);
  else if (a.x === b.x && b.y === a.y + 1) maze.h[a.y]?.splice(a.x, 1, false);
  else if (b.x === a.x && a.y === b.y + 1) maze.h[b.y]?.splice(b.x, 1, false);
}
