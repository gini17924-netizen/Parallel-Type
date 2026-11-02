// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
export class InvalidResultError extends Error {
  override name = "InvalidResultError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
  }

  get [Symbol.toStringTag]() {
    return "InvalidResultError";
  }
}
