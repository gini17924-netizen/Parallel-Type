// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
import { type CodePoint } from "./types.ts";

export function formatCodePoint(codePoint: CodePoint): string {
  return "U+" + codePoint.toString(16).padStart(4, "0");
}
