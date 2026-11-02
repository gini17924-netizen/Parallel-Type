// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
export type CodePoint = number;

export type CodePointSet = {
  has(codePoint: CodePoint): boolean;
};

export type HasCodePoint = {
  readonly codePoint: CodePoint;
};
