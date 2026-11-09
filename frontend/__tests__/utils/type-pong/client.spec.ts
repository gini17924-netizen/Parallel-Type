import { describe, expect, it } from "vitest";

import { createLanPongClient } from "../../../src/ts/utils/type-pong/client";
import {
  encodeSnapshot,
  INPUT_BATCH_MAX,
  type PongSnapshot,
} from "../../../src/ts/utils/type-pong/lan";

function snapshotAt(
  seq: number,
  overrides: Partial<PongSnapshot> = {},
): Record<string, unknown> {
  return encodeSnapshot({
    seq,
    phase: "running",
    winner: undefined,
    ball: { x: 50, y: 50, vx: 10, vy: 20 },
    hostX: 50,
    clientX: 50,
    hostScore: 0,
    clientScore: 0,
    hostWord: "volley",
    hostTyped: 0,
    clientWord: "volley",
    clientTyped: 0,
    rally: 0,
    bestRally: 0,
    ...overrides,
  });
}

describe("type-pong client layer (online wave, phase 44 — pattern V)", () => {
  it("ingests a fresh snapshot and drops stale seqs and garbage", () => {
    let clock = 0;
    const client = createLanPongClient({ now: () => clock });
    expect(client.ingest(snapshotAt(1))).toBe(true);
    expect(client.snapshot()?.seq).toBe(1);
    expect(client.ingest(snapshotAt(1))).toBe(false); //the same seq: stale
    expect(client.ingest(snapshotAt(0))).toBe(false); //older: stale
    expect(client.ingest(snapshotAt(2))).toBe(true);
    expect(client.snapshot()?.seq).toBe(2);
    expect(client.ingest("garbage")).toBe(false);
    expect(client.ingest({ seq: 3 })).toBe(false); //malformed: rejected
    expect(client.snapshot()?.seq).toBe(2);
  });

  it("the ball dead-reckons from the snapshot velocity (capped)", () => {
    let clock = 1000;
    const client = createLanPongClient({ now: () => clock });
    client.ingest(snapshotAt(1, { ball: { x: 50, y: 50, vx: 10, vy: -20 } }));
    clock = 1100; //+100ms
    expect(client.view().ballX).toBeCloseTo(51, 1); //+10 * 0.1s
    expect(client.view().ballY).toBeCloseTo(48, 1); //-20 * 0.1s
    clock = 5000; //+4000ms: the prediction caps at 150ms
    expect(client.view().ballX).toBeCloseTo(51.5, 1); //10 * 0.15s max
    //the ball clamps to the court
    client.ingest(snapshotAt(2, { ball: { x: 99, y: 50, vx: 50, vy: 0 } }));
    clock = 5100;
    expect(client.view().ballX).toBeLessThanOrEqual(100);
  });

  it("the opponent's paddle interpolates between the two last snapshots", () => {
    let clock = 0;
    const client = createLanPongClient({ now: () => clock });
    client.ingest(snapshotAt(1, { hostX: 20 }));
    clock = 50; //the second snapshot arrives 50ms later
    client.ingest(snapshotAt(2, { hostX: 40 }));
    clock = 75; //halfway between the two arrivals
    expect(client.view().hostX).toBeCloseTo(30, 0);
    clock = 200; //past the span: pinned on the latest value
    expect(client.view().hostX).toBeCloseTo(40, 0);
  });

  it("the local paddle pulls optimistically and snaps on completion", () => {
    let clock = 0;
    const client = createLanPongClient({ now: () => clock });
    client.ingest(
      snapshotAt(1, {
        clientWord: "volley",
        clientX: 30,
        ball: { x: 70, y: 50, vx: 0, vy: 0 },
      }),
    );
    expect(client.view().myX).toBeCloseTo(30, 1); //the resynced authoritative x
    //one correct char: the paddle pulls halfway (1/6 of the way) toward the ball
    client.pushLocalChar("v");
    expect(client.view().myTyped).toBe(1);
    const pulled = client.view().myX;
    expect(pulled).toBeGreaterThan(30);
    expect(pulled).toBeLessThan(70);
    //a wrong char is inert locally too
    const before = client.view().myX;
    client.pushLocalChar("z");
    expect(client.view().myTyped).toBe(1);
    expect(client.view().myX).toBeCloseTo(before, 1);
    //complete the word: the optimistic snap onto the ball
    for (const ch of "olley") {
      client.pushLocalChar(ch);
    }
    expect(client.view().myTyped).toBe(0); //the next word began
    expect(client.view().myX).toBeCloseTo(70, 0); //the ball's x
  });

  it("the next snapshot corrects the optimistic paddle", () => {
    let clock = 0;
    const client = createLanPongClient({ now: () => clock });
    client.ingest(
      snapshotAt(1, {
        clientWord: "volley",
        clientX: 30,
        ball: { x: 70, y: 50, vx: 0, vy: 0 },
      }),
    );
    client.pushLocalChar("v");
    client.pushLocalChar("o");
    expect(client.view().myTyped).toBe(2); //the local optimism ran ahead
    //the authoritative snapshot says only one char landed
    client.ingest(
      snapshotAt(2, {
        clientWord: "volley",
        clientX: 45,
        clientTyped: 1,
        ball: { x: 70, y: 50, vx: 0, vy: 0 },
      }),
    );
    expect(client.view().myTyped).toBe(1); //corrected
    expect(client.view().myX).toBeCloseTo(45, 1); //the authoritative x
  });

  it("the input batch drains in bounded slices without loss", () => {
    let clock = 0;
    const client = createLanPongClient({ now: () => clock });
    client.ingest(snapshotAt(1));
    for (let i = 0; i < INPUT_BATCH_MAX + 10; i++) {
      client.pushLocalChar("d");
    }
    const first = client.takeInputBatch();
    expect(first).toHaveLength(INPUT_BATCH_MAX);
    const second = client.takeInputBatch();
    expect(second).toHaveLength(10); //the rest, no loss
    expect(client.takeInputBatch()).toHaveLength(0);
    //non-single-char pushes are ignored
    client.pushLocalChar("abc");
    expect(client.takeInputBatch()).toHaveLength(0);
  });

  it("the view before any snapshot is neutral", () => {
    const client = createLanPongClient({ now: () => 0 });
    const view = client.view();
    expect(view.ballX).toBe(50);
    expect(view.hostX).toBe(50);
    expect(view.myWord).toBe("");
    expect(view.phase).toBe("running");
    expect(client.snapshot()).toBeUndefined();
  });

  it("a done snapshot carries the winner through the view", () => {
    let clock = 0;
    const client = createLanPongClient({ now: () => clock });
    client.ingest(
      snapshotAt(1, {
        phase: "done",
        winner: "host",
        hostScore: 5,
        clientScore: 2,
      }),
    );
    const view = client.view();
    expect(view.phase).toBe("done");
    expect(view.winner).toBe("host");
    expect(view.hostScore).toBe(5);
  });
});
