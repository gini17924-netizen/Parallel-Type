// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
export class DataError extends Error {
  override name = "DataError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
  }

  get [Symbol.toStringTag]() {
    return "DataError";
  }
}
