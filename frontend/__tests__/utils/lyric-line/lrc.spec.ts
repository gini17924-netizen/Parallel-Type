import { describe, expect, it } from "vitest";

import { parseLrc, type ParsedLrc } from "../../../src/ts/utils/lyric-line/lrc";

describe("lyric-line lrc parser (idea G20 phase 1)", () => {
  it("parses the standard [mm:ss.xx] timestamps", () => {
    const parsed = parseLRCFixture();
    expect(parsed.isTimed).toBe(true);
    expect(parsed.lines[0]?.tMs).toBe(83450); //01:23.45
    expect(parsed.lines[0]?.text).toBe("first line");
    expect(parsed.lines[1]?.tMs).toBe(84500); //[01:24.50]
  });

  it("handles multiple timestamps on one line (duplicated)", () => {
    const parsed = parseLrc("[00:01.00][00:05.00]chorus");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]?.tMs).toBe(1000);
    expect(parsed.lines[1]?.tMs).toBe(5000);
    expect(parsed.lines[1]?.text).toBe("chorus");
  });

  it("applies the [offset:] tag (positive = earlier)", () => {
    const parsed = parseLrc("[offset:+500]\n[00:10.00]late fix");
    expect(parsed.offsetMs).toBe(500);
    expect(parsed.lines[0]?.tMs).toBe(9500); //10s − 0.5s
  });

  it("ignores the metadata tags", () => {
    const parsed = parseLrc("[ti:song]\n[ar:artist]\n[00:01.00]line one");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.text).toBe("line one");
  });

  it("falls back to plain lines without any timestamp", () => {
    const parsed = parseLrc("just text\nsecond line\n\nfourth");
    expect(parsed.isTimed).toBe(false);
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.lines[0]?.tMs).toBeNull();
    expect(parsed.lines[2]?.text).toBe(""); //the blank instrumental line
  });

  it("collapses whitespace runs to one space (doc §۵)", () => {
    const parsed = parseLrc("[00:01.00]too   many\tspaces  here");
    expect(parsed.lines[0]?.text).toBe("too many spaces here");
  });

  it("sorts the timed lines and keeps the blank separators", () => {
    const parsed = parseLrc("[00:05.00]b\n\n[00:01.00]a");
    expect(parsed.lines[0]?.text).toBe("a");
    expect(parsed.lines[1]?.text).toBe("b");
  });

  it("parses a Persian LRC (UTF-8 passthrough)", () => {
    const parsed = parseLrc("[00:12.34]سلام دنیا\n[00:15.00]خط دوم");
    expect(parsed.lines[0]?.text).toBe("سلام دنیا");
    expect(parsed.lines[0]?.tMs).toBe(12340);
  });
});

function parseLRCFixture(): ParsedLrc {
  return parseLrc("[ti:fixture]\n[01:23.45]first line\n[01:24.50]second line");
}
