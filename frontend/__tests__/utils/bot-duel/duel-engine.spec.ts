import { describe, expect, it } from "vitest";

import {
  createDuelEngine,
  type DuelEngine,
  type DuelState,
} from "../../../src/ts/utils/bot-duel/duel-engine";

//3 words of 2 chars: cumEnd 2, 5, 8 chars -> a 60wpm bot finishes at 1600ms
const WORDS = ["aa", "bb", "cc"];

/** all times in this spec are ELAPSED running ms (the engine anchors at 1000) */
function runningEngine(botWpm = 60): DuelEngine {
  const engine = createDuelEngine({ words: WORDS, botWpm });
  engine.start(1000);
  return engine;
}

function feedChar(
  engine: ReturnType<typeof runningEngine>,
  elapsed: number,
  correct = true,
): DuelState {
  return engine.feed({ type: "char", correct }, 1000 + elapsed);
}

function feedWord(
  engine: ReturnType<typeof runningEngine>,
  elapsed: number,
  errors = 0,
): DuelState {
  return engine.feed({ type: "wordCompleted", errors }, 1000 + elapsed);
}

describe("bot-duel engine (idea G2)", () => {
  it("stays in ready until start; the bot does not move before it", () => {
    const engine = createDuelEngine({ words: WORDS, botWpm: 60 });
    expect(engine.state().phase).toBe("ready");
    expect(engine.tick(999999).botWordIndex).toBe(0);
    engine.start(1000);
    expect(engine.state().phase).toBe("running");
    expect(engine.state().botWordIndex).toBe(0); //elapsed 0 at the anchor
    expect(engine.botFinishMs).toBe(1600);
  });

  it("player wins on the last completion strictly before the bot's finish", () => {
    const engine = runningEngine();
    feedChar(engine, 100);
    feedChar(engine, 150);
    feedWord(engine, 200); //word 0
    feedChar(engine, 300);
    feedChar(engine, 350);
    feedWord(engine, 400); //word 1
    feedChar(engine, 500);
    feedChar(engine, 550);
    const state = feedWord(engine, 600); //word 2: 600 < 1600
    expect(state.phase).toBe("playerWon");
    expect(state.finishedAtMs).toBe(600);
    //playerChars: 6 chars + 3 spaces = 9; momentum 3 -> the capped bonus 10;
    //the bot typed 3 chars at 600ms
    expect(state.deltaChars).toBe(9 + 10 - 3);
  });

  it("bot wins when the player idles past its finish", () => {
    const engine = runningEngine();
    const state = engine.tick(1000 + 1700); //elapsed 1700 > 1600
    expect(state.phase).toBe("botWon");
    expect(state.finishedAtMs).toBe(1600);
    expect(state.botWordIndex).toBe(3);
  });

  it("a player completion cannot overtake a bot that crossed strictly earlier", () => {
    const engine = runningEngine();
    feedChar(engine, 100);
    feedChar(engine, 150);
    feedWord(engine, 200);
    feedChar(engine, 300);
    feedChar(engine, 350);
    feedWord(engine, 400);
    //no tick ran after the bot's 1600ms crossing, yet the player's final
    //completion lands at elapsed 1700: the bot wins by time, not by luck
    feedChar(engine, 1650);
    feedChar(engine, 1670);
    const state = feedWord(engine, 1700);
    expect(state.phase).toBe("botWon");
    expect(state.finishedAtMs).toBe(1600);
  });

  it("an exact tie is a draw", () => {
    const engine = runningEngine();
    feedChar(engine, 100);
    feedChar(engine, 150);
    feedWord(engine, 200);
    feedChar(engine, 300);
    feedChar(engine, 350);
    feedWord(engine, 400);
    //the final completion lands exactly on the bot's finish millisecond
    feedChar(engine, 1550);
    feedChar(engine, 1570);
    const state = feedWord(engine, 1600);
    expect(state.phase).toBe("draw");
    expect(state.finishedAtMs).toBe(1600);
  });

  it("momentum builds on perfect words, resets on a wrong key, stays display-only", () => {
    const engine = runningEngine();
    feedChar(engine, 100);
    feedChar(engine, 150);
    const state = feedWord(engine, 200); //perfect: momentum 1
    expect(state.momentum).toBe(1);
    //delta = playerChars (2 chars + 1 space = 3) + bonus (5) - bot (1 char)
    expect(state.deltaChars).toBe(7);

    //a wrong key resets the momentum
    const broken = engine.feed({ type: "char", correct: false }, 250);
    expect(broken.momentum).toBe(0);

    //an imperfect word does not build it back
    feedChar(engine, 300);
    const after = feedWord(engine, 400, 1);
    expect(after.momentum).toBe(0);
    expect(after.playerCorrectChars).toBe(3);
    expect(after.playerWrongChars).toBe(1);
  });

  it("a terminal phase ignores further feed and tick", () => {
    const engine = runningEngine();
    engine.tick(1000 + 1700); //botWon
    const before = engine.state();
    engine.feed({ type: "char", correct: true }, 1000 + 1800);
    engine.feed({ type: "wordCompleted", errors: 0 }, 1000 + 1900);
    engine.tick(1000 + 5000);
    expect(engine.state()).toEqual(before);
  });
});

describe("bot-duel injected pacer (idea G3)", () => {
  it("an injected pacer replaces the constant-rate movement", () => {
    //a fast curve-like pacer: finishes the 8-char race at 400ms
    const engine = createDuelEngine({
      words: WORDS,
      botWpm: 60,
      pacer: {
        progressChars: (elapsedMs) => (elapsedMs / 1000) * 20,
        wordIndex: (elapsedMs) => Math.min(3, Math.floor(elapsedMs / 400)),
        finished: (elapsedMs) => elapsedMs >= 400,
        finishMs: 400,
        totalChars: 8,
      },
    });
    engine.start(1000);
    expect(engine.tick(1000 + 300).phase).toBe("running");
    const state = engine.tick(1000 + 450);
    expect(state.phase).toBe("botWon");
    expect(state.finishedAtMs).toBe(400);
  });
});
