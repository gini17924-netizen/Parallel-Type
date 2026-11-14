import { describe, expect, it } from "vitest";

import {
  advance,
  createBracket,
  currentMatch,
  decideWinner,
  handleTournamentMessage,
  getTournament,
  isTournamentComplete,
  resolveReport,
  type FinishReport,
  type TournamentPlayer,
} from "../../src/ts/states/lan-tournament";

function players(...ids: number[]): TournamentPlayer[] {
  return ids.map((id) => ({ clientId: id, name: `P${id}` }));
}

function report(finishMs: number | null, acc = 95): FinishReport {
  return { finishMs, acc };
}

describe("phase 78 — the elimination bracket", () => {
  it("four players make two rounds with no byes", () => {
    const state = createBracket(players(1, 2, 3, 4), {}, 42);
    expect(state.rounds).toHaveLength(1); //r2 builds when r1 completes
    expect(state.rounds[0]).toHaveLength(2);
    for (const match of state.rounds[0] as never[]) {
      const m = match as { players: [number | null, number | null]; done: boolean };
      expect(m.players[0]).not.toBeNull();
      expect(m.players[1]).not.toBeNull();
      expect(m.done).toBe(false);
    }
    expect(currentMatch(state)).toBeDefined();
  });

  it("three players pad to a bye that settles immediately", () => {
    const state = createBracket(players(1, 2, 3), {}, 42);
    const first = state.rounds[0] as unknown as {
      players: [number, number | null];
      done: boolean;
      winner?: number;
    }[];
    //one real match + one bye
    const real = first.filter((m) => m.players[1] !== null);
    const byes = first.filter((m) => m.players[1] === null);
    expect(real).toHaveLength(1);
    expect(byes).toHaveLength(1);
    expect(byes[0]?.done).toBe(true);
    expect(byes[0]?.winner).not.toBeNull();
    //the current match is the real one, not the settled bye
    expect(currentMatch(state)?.index).toBe(real[0]?.index);
  });

  it("decideWinner: the real finish beats null, the faster wins, acc breaks ties", () => {
    expect(decideWinner(report(10_000), report(null))).toBe(0);
    expect(decideWinner(report(null), report(10_000))).toBe(1);
    expect(decideWinner(report(9_000), report(10_000))).toBe(0);
    expect(decideWinner(report(10_000), report(9_000))).toBe(1);
    //both null: the higher acc advances
    expect(decideWinner(report(null, 97), report(null, 90))).toBe(0);
    expect(decideWinner(report(null, 90), report(null, 97))).toBe(1);
    //full tie: index 0 (deterministic)
    expect(decideWinner(report(10_000, 95), report(10_000, 95))).toBe(0);
  });

  it("a full FOUR-PLAYER tournament runs to a champion (the phase gate)", () => {
    let state = createBracket(players(1, 2, 3, 4), {}, 42);

    //round 1: the seed shuffles the pairings — drive each match by its
    //actual players (the SECOND listed player wins both)
    let match = currentMatch(state) as { players: [number, number] };
    const r1winner1 = match.players[1];
    state = advance(state, r1winner1);
    match = currentMatch(state) as { players: [number, number] };
    const r1winner2 = match.players[1];
    state = advance(state, r1winner2);

    //the final is built from the winners
    expect(state.rounds).toHaveLength(2);
    const final = state.rounds[1]?.[0] as {
      players: [number, number];
      done: boolean;
    };
    expect(final.players).toEqual([r1winner1, r1winner2]);
    expect(final.done).toBe(false);

    //the final: the first-listed player beats the second
    match = currentMatch(state) as { players: [number, number] };
    state = advance(state, match.players[0]);
    expect(isTournamentComplete(state)).toBe(true);
    expect(state.champion).toBe(r1winner1);
    expect(currentMatch(state)).toBeUndefined();
  });

  it("a mid-match disconnect counts as a null finish — the opponent advances", () => {
    //the room map after a player left: their entry is gone
    const room = { 1: { finished: report(8_000) as FinishReport } };
    const a = resolveReport(room, 1);
    const b = resolveReport(room, 2); //gone
    expect(a.resolved).toBe(true);
    expect(b.resolved).toBe(true);
    expect(decideWinner(a.report, b.report)).toBe(0);
  });

  it("an unresolved player keeps the match waiting", () => {
    //present in the room but no finished report yet = still racing
    const room = {
      1: { finished: report(8_000) as FinishReport },
      2: {},
    };
    const b = resolveReport(room, 2);
    expect(b.resolved).toBe(false);
  });
});

describe("phase 78 — the wire messages", () => {
  it("a valid host broadcast replaces the bracket; null clears it", () => {
    const state = createBracket(players(1, 2), {}, 42);
    handleTournamentMessage(JSON.parse(JSON.stringify(state)));
    expect(getTournament()?.players).toHaveLength(2);
    handleTournamentMessage(null);
    expect(getTournament()).toBeUndefined();
  });

  it("garbage shapes are ignored", () => {
    handleTournamentMessage({ rounds: "no" });
    expect(getTournament()).toBeUndefined();
    handleTournamentMessage("strings are not brackets");
    expect(getTournament()).toBeUndefined();
  });
});
