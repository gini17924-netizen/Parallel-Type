// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile
export type LoadingEvent = {
  readonly total: number;
  readonly current: number;
};

export type LoadingEventListener = (event: LoadingEvent) => void;
