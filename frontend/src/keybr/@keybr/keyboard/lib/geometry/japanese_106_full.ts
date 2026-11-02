// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
import { type GeometryDict } from "../types.ts";
import { EXTRA } from "./extra.ts";
import { JAPANESE_106 } from "./japanese_106.ts";

export const JAPANESE_106_FULL: GeometryDict = {
  ...JAPANESE_106,
  ...EXTRA,
};
