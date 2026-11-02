// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
import { type Content } from "./types.ts";

export function flattenContent(content: Content): readonly string[] {
  const result: string[] = [];
  for (const [title, paragraphs] of content) {
    result.push(...paragraphs);
  }
  return result;
}

export function splitParagraph(paragraph: string): readonly string[] {
  return paragraph.split(/\s+/g);
}
