import { BALANCE } from "./balance";
import { keyOf, manhattan, type Point } from "./grid";
import { nextCell } from "./steer";

/**
 * Type Snake engine (idea G11, phase 1): the snake auto-walks toward the
 * food (steer, one step per tick — typing is NOT the steering); a 2-3
 * letter word rides the food and typing it RIPENS the food; the eat lands
 * when the head stands on the ripe food (grow + len x 15 + combo). The
 * movement continues regardless of typing — the snake must survive until
 * the word completes (doc G11 §۰.۳). Death = no safe step exists
 * (surrounded); walls/body are lethal. Every 5 foods the interval speeds
 * up x1.1 (floored).
 *
 * PURE: the injected foodWord callback supplies the food words; the rng
 * is injected for the food placement.
 */

export type TypeSnakePhase = "running" | "done";

export type SnakeFood = {
  x: number;
  y: number;
  word: string;
  /** letters typed toward the ripening */
  typed: number;
};

export type TypeSnakeResult = {
  score: number;
  length: number;
  eaten: number;
  maxCombo: number;
};

export type TypeSnakeState = {
  phase: TypeSnakePhase;
  snake: Point[]; //head first
  food: SnakeFood | undefined;
  score: number;
  combo: number;
  maxCombo: number;
  eaten: number;
  intervalMs: number;
  elapsedMs: number;
  cols: number;
  rows: number;
  result: TypeSnakeResult | undefined;
};

export type TypeSnakeEngine = {
  state(): TypeSnakeState;
  /** one movement step when the interval elapses */
  tick(dtMs: number): TypeSnakeState;
  /** a letter against the food's word (wrong letters are inert) */
  feedKey(key: string): TypeSnakeState;
};

export function createTypeSnakeEngine(options: {
  foodWord: () => string;
  rng: () => number;
  cols?: number;
  rows?: number;
  /** test hook: a fixed initial body (head first) */
  startSnake?: Point[];
}): TypeSnakeEngine {
  const cols = options.cols ?? BALANCE.cols;
  const rows = options.rows ?? BALANCE.rows;
  let phase: TypeSnakePhase = "running";
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let eaten = 0;
  let intervalMs: number = BALANCE.startIntervalMs;
  let elapsedMs = 0;
  let moveAcc = 0;

  const snake: Point[] =
    options.startSnake ??
    Array.from({ length: BALANCE.startLength }, (_, i) => ({
      x: Math.floor(cols / 4) + (BALANCE.startLength - 1 - i),
      y: Math.floor(rows / 2),
    }));

  function bodyCells(): Set<string> {
    return new Set(snake.map(keyOf));
  }

  function freeCells(): Point[] {
    const body = bodyCells();
    const free: Point[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!body.has(keyOf({ x, y }))) free.push({ x, y });
      }
    }
    return free;
  }

  let food: SnakeFood | undefined = spawnFood();

  function spawnFood(): SnakeFood {
    const free = freeCells();
    const head = snake[0];
    //prefer cells at least foodMinDistance from the head; relax if the
    //grid is crowded
    const far = free.filter(
      (p) =>
        head !== undefined && manhattan(head, p) >= BALANCE.foodMinDistance,
    );
    const source = far.length > 0 ? far : free;
    const spot = source[Math.floor(options.rng() * source.length)];
    if (spot === undefined) {
      //nowhere left: an unreachable food means the snake already won the
      //grid — treat as a normal food on the head's cell
      return { x: head?.x ?? 0, y: head?.y ?? 0, word: "ok", typed: 0 };
    }
    return { x: spot.x, y: spot.y, word: options.foodWord(), typed: 0 };
  }

  function finish(): TypeSnakeState {
    phase = "done";
    return snapshot();
  }

  function snapshot(): TypeSnakeState {
    return {
      phase,
      snake: snake.map((p) => ({ ...p })),
      food: food === undefined ? undefined : { ...food },
      score,
      combo,
      maxCombo,
      eaten,
      intervalMs,
      elapsedMs,
      cols,
      rows,
      result:
        phase === "done"
          ? { score, length: snake.length, eaten, maxCombo }
          : undefined,
    };
  }

  function eat(): void {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    eaten += 1;
    score += (food?.word.length ?? 0) * BALANCE.scorePerChar;
    //grow: duplicate the head (the head already stands on the food)
    const head = snake[0];
    if (head !== undefined) snake.unshift({ ...head });
    if (eaten % BALANCE.speedUpEveryFoods === 0) {
      intervalMs = Math.max(
        BALANCE.minIntervalMs,
        Math.round(intervalMs / BALANCE.speedUpFactor),
      );
    }
    food = spawnFood();
  }

  function step(): void {
    const head = snake[0];
    if (head === undefined || food === undefined) return;
    const onFood = head.x === food.x && head.y === food.y;
    if (onFood) {
      if (food.typed >= food.word.length) eat(); //ripe: eat in place
      //unripe: wait on the food cell (no movement)
      return;
    }
    //blocked = the body except the tail (the tail vacates this step)
    const blocked = bodyCells();
    const tail = snake[snake.length - 1];
    if (tail !== undefined) blocked.delete(keyOf(tail));
    const next = nextCell(head, { x: food.x, y: food.y }, blocked, cols, rows);
    if (next === undefined) {
      finish(); //surrounded: nowhere to go
      return;
    }
    snake.unshift(next);
    snake.pop();
  }

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running") return snapshot();
      elapsedMs += dtMs;
      moveAcc += dtMs;
      while (moveAcc >= intervalMs) {
        moveAcc -= intervalMs;
        step();
        if (phase !== "running") break;
      }
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (food === undefined) return snapshot();
      if (key.length !== 1) return snapshot();
      const ch = key.toLowerCase();
      const expected = food.word[food.typed]?.toLowerCase();
      if (expected !== ch) return snapshot(); //inert (doc G11 §۰.۲)
      food.typed += 1;
      return snapshot();
    },
  };
}
