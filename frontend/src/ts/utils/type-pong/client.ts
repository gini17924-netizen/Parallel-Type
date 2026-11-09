import { BALANCE } from "./balance";
import {
  decodeSnapshot,
  INPUT_BATCH_MAX,
  type LanPongPhase,
  type PongSide,
  type PongSnapshot,
} from "./lan";

/**
 * Type Pong's client layer (online wave, phase 44 — pattern V): the
 * client never simulates — it renders the host's snapshots. Between two
 * snapshots (50ms apart) it bridges the gap locally:
 * - the ball dead-reckons from the last snapshot's velocity (capped — a
 *   short local prediction, the next snapshot corrects),
 * - the opponent's paddle (the host) interpolates between the last two
 *   snapshots' positions,
 * - the LOCAL paddle moves optimistically with the same pull formula the
 *   host applies — the next snapshot's authoritative value corrects it.
 * Typed chars accumulate into a bounded input batch the page relays.
 *
 * PURE: the clock is injected.
 */

/** how far the local prediction may run ahead of the last snapshot */
const EXTRAPOLATION_CAP_MS = 150;

export type ClientPongView = {
  seq: number;
  phase: LanPongPhase;
  winner: PongSide | undefined;
  /** the dead-reckoned ball (the local prediction) */
  ballX: number;
  ballY: number;
  /** the opponent's paddle (interpolated between the last two snapshots) */
  hostX: number;
  /** the local paddle (the optimistic pull, corrected per snapshot) */
  myX: number;
  hostScore: number;
  clientScore: number;
  /** the local typing state (the snapshot's authoritative word) */
  myWord: string;
  myTyped: number;
  /** the opponent's typing state (from the snapshot) */
  theirWord: string;
  theirTyped: number;
  /** the live rally length (from the snapshot) */
  rally: number;
};

type Anchor = { snap: PongSnapshot; arrivalMs: number };

const clampX = (x: number): number => Math.max(0, Math.min(BALANCE.courtW, x));
const clampY = (y: number): number =>
  Math.max(-5, Math.min(BALANCE.courtH + 5, y));

export function createLanPongClient(options: { now: () => number }): {
  /** decodes + accepts a raw snapshot; stale seqs and garbage return false */
  ingest(raw: unknown): boolean;
  /** a local keystroke: the optimistic echo + the input batch */
  pushLocalChar(ch: string): void;
  /** drains up to INPUT_BATCH_MAX chars for the wire (no loss: the rest
   * stays queued for the next call) */
  takeInputBatch(): string[];
  /** the interpolated/extrapolated view at the injected now() */
  view(): ClientPongView;
  /** the last accepted snapshot (the score panel reads it directly) */
  snapshot(): PongSnapshot | undefined;
} {
  const now = options.now;
  let last: Anchor | undefined;
  let prev: Anchor | undefined;
  //the optimistic local paddle state (resynced by every accepted snapshot)
  let myTyped = 0;
  let myXPinned: number | undefined;
  let batch: string[] = [];

  const view = (): ClientPongView => {
    if (last === undefined) {
      return {
        seq: 0,
        phase: "running",
        winner: undefined,
        ballX: 50,
        ballY: 50,
        hostX: 50,
        myX: 50,
        hostScore: 0,
        clientScore: 0,
        myWord: "",
        myTyped: 0,
        theirWord: "",
        theirTyped: 0,
        rally: 0,
      };
    }
    const snap = last.snap;
    const dtMs = Math.max(
      0,
      Math.min(EXTRAPOLATION_CAP_MS, now() - last.arrivalMs),
    );
    //the ball dead-reckons (the short local prediction)
    const ballX = clampX(snap.ball.x + (snap.ball.vx * dtMs) / 1000);
    const ballY = clampY(snap.ball.y + (snap.ball.vy * dtMs) / 1000);
    //the opponent's paddle interpolates between the two last snapshots,
    //rendered one span BEHIND (the classic interpolation delay)
    let hostX = snap.hostX;
    if (prev !== undefined && last.arrivalMs > prev.arrivalMs) {
      const span = last.arrivalMs - prev.arrivalMs;
      const renderTime = now() - span;
      const progress = Math.max(
        0,
        Math.min(1, (renderTime - prev.arrivalMs) / span),
      );
      hostX = prev.snap.hostX + (snap.hostX - prev.snap.hostX) * progress;
    }
    //the local paddle: the authoritative position stands; only the chars
    //typed LOCALLY beyond it pull toward the predicted ball (the short
    //local prediction — the next snapshot corrects)
    let myX: number;
    if (myXPinned !== undefined) {
      myX = myXPinned; //the word completed locally: snapped
    } else {
      const extra = Math.max(0, myTyped - snap.clientTyped);
      const wordLen = Math.max(1, snap.clientWord.length);
      myX =
        snap.clientX + (ballX - snap.clientX) * Math.min(1, extra / wordLen);
    }
    return {
      seq: snap.seq,
      phase: snap.phase,
      winner: snap.winner,
      ballX,
      ballY,
      hostX,
      myX,
      hostScore: snap.hostScore,
      clientScore: snap.clientScore,
      myWord: snap.clientWord,
      myTyped,
      theirWord: snap.hostWord,
      theirTyped: snap.hostTyped,
      rally: snap.rally,
    };
  };

  return {
    ingest(raw) {
      const snap = decodeSnapshot(raw);
      if (snap === undefined) return false;
      if (last !== undefined && snap.seq <= last.snap.seq) return false; //stale
      prev = last;
      last = { snap, arrivalMs: now() };
      //resync the optimistic paddle to the authoritative values
      myTyped = snap.clientTyped;
      myXPinned = undefined;
      return true;
    },
    pushLocalChar(ch) {
      if (typeof ch !== "string" || ch.length !== 1) return;
      batch.push(ch);
      const viewNow = view();
      if (viewNow.phase !== "running") return;
      const expected = viewNow.myWord[myTyped]?.toLowerCase();
      if (expected !== ch.toLowerCase()) return; //inert locally too
      myTyped += 1;
      if (myTyped >= viewNow.myWord.length) {
        //the word complete: the optimistic snap onto the predicted ball
        myXPinned = view().ballX;
        myTyped = 0;
      }
    },
    takeInputBatch() {
      const drained = batch.slice(0, INPUT_BATCH_MAX);
      batch = batch.slice(drained.length);
      return drained;
    },
    view,
    snapshot() {
      return last?.snap;
    },
  };
}
