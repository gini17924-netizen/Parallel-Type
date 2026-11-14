import { beforeEach, describe, expect, it } from "vitest";

import {
  CHAT_MAX_CHARS,
  clearLanChat,
  getLanChatLog,
  receiveLanChat,
  sendLanChat,
} from "../../src/ts/states/lan-chat";

describe("phase 80 — the lobby chat", () => {
  beforeEach(() => {
    clearLanChat();
  });

  it("sends clamped to 280 chars and logs its own message", () => {
    const long = "x".repeat(400);
    const entry = sendLanChat(`  ${long}  `);
    expect(entry?.text).toHaveLength(CHAT_MAX_CHARS);
    const log = getLanChatLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.text).toHaveLength(CHAT_MAX_CHARS);
    expect(log[0]?.from).toBe("P1"); //the v1 fallback name without a session
  });

  it("an empty or whitespace-only text sends nothing", () => {
    expect(sendLanChat("   ")).toBeUndefined();
    expect(sendLanChat("")).toBeUndefined();
    expect(getLanChatLog()).toEqual([]);
  });

  it("receiving clamps the text and caps the log at 50", () => {
    for (let i = 0; i < 55; i++) {
      receiveLanChat({ from: `P${i}`, text: `m${i}`, ts: i }, i + 1);
    }
    const log = getLanChatLog();
    expect(log).toHaveLength(50);
    //the oldest were dropped: the first kept row is m5
    expect(log[0]?.text).toBe("m5");
  });

  it("empty text from the wire is not a chat", () => {
    receiveLanChat({ from: "P1", text: "" }, 1);
    receiveLanChat({ from: "P1" }, 1);
    expect(getLanChatLog()).toEqual([]);
  });

  it("the relay's clientId rides the entry (the roster maps the author)", () => {
    receiveLanChat({ from: "P2", text: "hi", ts: 5 }, 2);
    expect(getLanChatLog()[0]?.clientId).toBe(2);
    //an id-less chat = the host's own send (or a v1 pipe)
    receiveLanChat({ from: "HOST", text: "gl" });
    expect(getLanChatLog()[1]?.clientId).toBeUndefined();
  });

  it("clearLanChat forgets the log", () => {
    sendLanChat("hello");
    expect(getLanChatLog()).toHaveLength(1);
    clearLanChat();
    expect(getLanChatLog()).toEqual([]);
  });
});
