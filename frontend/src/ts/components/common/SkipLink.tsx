import { JSXElement } from "solid-js";

/**
 * phase 95: the keyboard skip link — the first focusable element of the app
 * shell (App.tsx places it before the header). invisible until focused;
 * one tab from the top of the page jumps straight to the page body.
 */
export function SkipLink(): JSXElement {
  return (
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-main focus:p-2 focus:text-bg"
    >
      skip to content
    </a>
  );
}
