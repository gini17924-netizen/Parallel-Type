/**
 * Stack Attack grid (idea G12, phase 1): pure cell math — placement,
 * collision, full-row clears with the shift-down. A cell stores the
 * letter it holds (enough for the render; the doc's {wordId, charIdx}
 * shape carried no extra logic).
 */

export type GridCell = { wordId: number; letter: string };

export type Grid = (GridCell | undefined)[][]; //rows x cols

export function emptyGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => undefined),
  );
}

/** every cell the block would occupy at (row, col..col+len-1) is empty
 * and inside the columns; rows above the top (negative) are allowed
 * (the entering block) */
export function canPlace(
  grid: Grid,
  row: number,
  col: number,
  len: number,
): boolean {
  if (col < 0 || col + len > (grid[0]?.length ?? 0)) return false;
  if (row >= grid.length) return false;
  if (row < 0) return true;
  for (let i = 0; i < len; i++) {
    if (grid[row]?.[col + i] !== undefined) return false;
  }
  return true;
}

/** writes the block's letters into the row (precondition: canPlace —
 * out-of-bounds cells are skipped defensively) */
export function place(
  grid: Grid,
  row: number,
  col: number,
  word: string,
  wordId: number,
): void {
  const gridRow = grid[row];
  if (gridRow === undefined || row < 0) return;
  for (let i = 0; i < word.length; i++) {
    if (col + i < 0 || col + i >= gridRow.length) continue;
    if (gridRow[col + i] === undefined) {
      gridRow[col + i] = { wordId, letter: word[i] ?? "" };
    }
  }
}

/** the row below the block's span is blocked (occupied or the floor) */
export function supportedBelow(
  grid: Grid,
  row: number,
  col: number,
  len: number,
): boolean {
  const below = row + 1;
  if (below >= grid.length) return true; //the floor
  for (let i = 0; i < len; i++) {
    if (grid[below]?.[col + i] !== undefined) return true;
  }
  return false;
}

/** clears every full row, shifts everything above down, returns the
 * cleared line count (0 = none); the engine re-pads the top afterwards */
export function clearFullRows(grid: Grid): number {
  let lines = 0;
  for (let row = grid.length - 1; row >= 0; row--) {
    const cells = grid[row] ?? [];
    if (cells.every((cell) => cell !== undefined)) {
      grid.splice(row, 1);
      lines += 1;
    }
  }
  return lines;
}

/** re-pads the grid's top with empty rows so the height stays constant
 * after clears (called by the engine, which knows the row count) */
export function refillRows(grid: Grid, rows: number, cols: number): void {
  while (grid.length < rows) {
    grid.unshift(Array.from({ length: cols }, () => undefined));
  }
}
