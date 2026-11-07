import { describe, expect, it } from "vitest";

import {
  ghostFromLastResult,
  ghostFromPersonalBest,
} from "../../../src/ts/utils/ghost-gp/ghost-source";

describe("ghost-gp sources (idea G3 phase 1)", () => {
  describe("ghostFromLastResult", () => {
    it("rejects a missing result with a clear reason", () => {
      const result = ghostFromLastResult(undefined, "english");
      expect(result).toEqual({ ok: false, reason: "no-result" });
    });

    it("rejects a result from another language", () => {
      const result = ghostFromLastResult(
        { wpm: 90, language: "persian" },
        "english",
      );
      expect(result).toEqual({ ok: false, reason: "wrong-language" });
    });

    it("rejects a zero/nonsense wpm", () => {
      expect(
        ghostFromLastResult({ wpm: 0, language: "english" }, "english"),
      ).toEqual({ ok: false, reason: "invalid-wpm" });
      expect(
        ghostFromLastResult(
          { wpm: Number.NaN, language: "english" },
          "english",
        ),
      ).toEqual({ ok: false, reason: "invalid-wpm" });
    });

    it("builds a constant ghost from a matching result", () => {
      const result = ghostFromLastResult(
        { wpm: 92, language: "english" },
        "english",
      );
      expect(result).toEqual({
        ok: true,
        ghost: { kind: "constant", wpm: 92, label: "last run" },
      });
    });
  });

  describe("ghostFromPersonalBest", () => {
    it("rejects a missing PB", () => {
      expect(ghostFromPersonalBest(undefined, "english")).toEqual({
        ok: false,
        reason: "no-result",
      });
    });

    it("rejects a PB of another language (the identity match includes it)", () => {
      expect(
        ghostFromPersonalBest({ wpm: 120, language: "german" }, "english"),
      ).toEqual({ ok: false, reason: "wrong-language" });
    });

    it("builds a constant ghost from a matching PB", () => {
      const result = ghostFromPersonalBest(
        { wpm: 120, language: "english" },
        "english",
      );
      expect(result).toEqual({
        ok: true,
        ghost: { kind: "constant", wpm: 120, label: "personal best" },
      });
    });
  });
});
