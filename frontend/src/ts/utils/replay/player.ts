import { type StackAttackState } from "../stack-attack/engine";
import {
  type ReplayEvent,
  type ReplayFile,
} from "./recorder";

/**
 * The replay player (phase 81): drives a FRESH engine through the
 * recorded timeline one tick at a time — the events due at each tick
 * apply in order (letters first, then steering, matching the live page's
 * handler order), then the engine advances. The caller owns the tick
 * cadence (the page's 50ms loop) and the render.
 */

export type ReplayEngine = {
  tick(dtMs: number): StackAttackState;
  feedKey(key: string): StackAttackState;
  moveCol(dir: -1 | 1): StackAttackState;
};

export type ReplayPlayer = {
  /** applies the events due at the current tick, then advances the
   * engine by the tick's dt; returns the engine's post-tick state;
   * undefined once the timeline is exhausted */
  step(engine: ReplayEngine): StackAttackState | undefined;
  done(): boolean;
  tickIndex(): number;
};

export function createReplayPlayer(
  file: ReplayFile,
  dtMs: number,
): ReplayPlayer {
  let index = 0;
  let cursor = 0; //the event cursor — the events are tick-ordered
  return {
    step(engine: ReplayEngine): StackAttackState | undefined {
      if (index >= file.durationTicks) return undefined;
      while (
        cursor < file.events.length &&
        (file.events[cursor] as ReplayEvent).tick === index
      ) {
        const event = file.events[cursor] as ReplayEvent;
        if (event.kind === "key" && event.k !== undefined) {
          engine.feedKey(event.k);
        } else if (event.kind === "left") {
          engine.moveCol(-1);
        } else if (event.kind === "right") {
          engine.moveCol(1);
        }
        cursor += 1;
      }
      const state = engine.tick(dtMs);
      index += 1;
      return state;
    },
    done(): boolean {
      return index >= file.durationTicks;
    },
    tickIndex(): number {
      return index;
    },
  };
}
