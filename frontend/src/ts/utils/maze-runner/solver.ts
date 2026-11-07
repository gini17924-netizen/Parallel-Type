import { BALANCE } from "./balance";
import {
  generateMaze,
  mazeExit,
  mazeStart,
  neighbors,
  type Cell,
  type Maze,
} from "./maze";

/**
 * Maze Runner solver (idea G14, phase 1): the BFS path from the entrance
 * to the exit plus the gate placement — a gate word every k path cells
 * (doc §۲). The turn count feeds the regenerate-until-twisty loop. PURE.
 */

/** the shortest path start→exit; always exists for a backtracker maze */
export function bfsPath(maze: Maze): Cell[] {
  const start = mazeStart();
  const exit = mazeExit(maze);
  const prev = new Map<string, string | null>();
  const queue: Cell[] = [start];
  prev.set(`${start.x},${start.y}`, null);
  while (queue.length > 0) {
    const cell = queue.shift();
    if (cell === undefined) break;
    if (cell.x === exit.x && cell.y === exit.y) break;
    for (const next of neighbors(maze, cell)) {
      const key = `${next.x},${next.y}`;
      if (prev.has(key)) continue;
      prev.set(key, `${cell.x},${cell.y}`);
      queue.push(next);
    }
  }
  const path: Cell[] = [];
  let cursor: string | null = `${exit.x},${exit.y}`;
  while (cursor !== null) {
    const [x, y] = cursor.split(",").map((it) => Number(it));
    path.unshift({ x: x ?? 0, y: y ?? 0 });
    cursor = prev.get(cursor) ?? null;
  }
  return path;
}

/** the direction changes along a path (the twistiness measure, doc §۵):
 * a turn is where the STEP direction changes between consecutive cells */
export function countTurns(path: Cell[]): number {
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const a = path[i - 2];
    const b = path[i - 1];
    const c = path[i];
    if (a === undefined || b === undefined || c === undefined) continue;
    const dx1 = b.x - a.x;
    const dy1 = b.y - a.y;
    const dx2 = c.x - b.x;
    const dy2 = c.y - b.y;
    if (dx1 !== dx2 || dy1 !== dy2) turns += 1;
  }
  return turns;
}

export type GatePlan = {
  /** the path index the gate sits on (never 0 or the exit) */
  pathIndex: number;
  cell: Cell;
  word: string;
};

/** a gate every k path cells, words from the injected picker (doc §۲) */
export function placeGates(
  path: Cell[],
  every: number,
  pickWord: (index: number) => string,
): GatePlan[] {
  const gates: GatePlan[] = [];
  for (let i = every; i < path.length - 1; i += every) {
    const cell = path[i];
    if (cell === undefined) continue;
    gates.push({ pathIndex: i, cell, word: pickWord(gates.length) });
  }
  return gates;
}

/** gate words filtered to the level's length window (doc §۰.۶) */
export function gateWordPicker(
  words: string[],
  minLen: number,
  maxLen: number,
  rng: () => number,
): (index: number) => string {
  const pool = [
    ...new Set(
      words
        .filter(
          (word) =>
            word.length >= minLen &&
            word.length <= maxLen &&
            /^\p{L}+$/u.test(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)) % (i + 1);
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) continue;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  if (shuffled.length === 0) shuffled.push("gate");
  return (index: number): string => shuffled[index % shuffled.length] ?? "gate";
}

/** generates a maze whose BFS path twists at least minTurns (doc §۵:
 * regenerate with fresh seeds until twisty enough or the cap hits) */
export function buildTwistyMaze(
  cols: number,
  rows: number,
  rng: () => number,
): { maze: Maze; path: Cell[]; turns: number } {
  let best: { maze: Maze; path: Cell[]; turns: number } | undefined;
  for (let attempt = 0; attempt < BALANCE.maxRegenerates; attempt++) {
    const maze = generateMaze(cols, rows, rng);
    const path = bfsPath(maze);
    const turns = countTurns(path);
    if (best === undefined || turns > best.turns) best = { maze, path, turns };
    if (turns >= BALANCE.minTurns) return { maze, path, turns };
  }
  //the cap hit: the twistiest attempt wins
  return (
    best ?? {
      maze: generateMaze(cols, rows, rng),
      path: bfsPath({
        cols,
        rows,
        v: Array.from({ length: rows }, () =>
          Array.from({ length: Math.max(0, cols - 1) }, () => false),
        ),
        h: Array.from({ length: Math.max(0, rows - 1) }, () =>
          Array.from({ length: cols }, () => false),
        ),
      }),
      turns: 0,
    }
  );
}
