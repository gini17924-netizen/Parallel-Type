import { Link } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { JSXElement } from "solid-js";

import { restartTestEvent } from "../../../events/test";
import { getRoutePage } from "../../../states/router";
import { getFocus } from "../../../states/test";
import { cn } from "../../../utils/cn";
import { isDevEnvironment } from "../../../utils/env";

/**
 * Colour layers of the ParallelType emblem. Each layer is a white shape
 * rendered as a CSS mask and filled with a theme colour, so the logo
 * follows the active theme automatically.
 */
function maskLayerStyle(image: string, color: string): JSX.CSSProperties {
  const mask = `url(/images/${image})`;
  return {
    "background-color": color,
    "-webkit-mask-image": mask,
    "mask-image": mask,
    "-webkit-mask-position": "center",
    "mask-position": "center",
    "-webkit-mask-size": "contain",
    "mask-size": "contain",
    "-webkit-mask-repeat": "no-repeat",
    "mask-repeat": "no-repeat",
  };
}

export function Logo(): JSXElement {
  return (
    <Link
      to="/"
      class="-m-2 flex h-10 w-max gap-3 rounded-[0.8rem] p-2 focus-visible:**:data-[ui-element='logoSubtext']:text-transparent"
      aria-label="ParallelType Home"
      style={{
        "box-sizing": "content-box",
        "font-family": "Lexend Deca ,sans-serif",
      }}
      data-ui-element="logo"
      onClick={() => {
        if (getRoutePage() === "test") restartTestEvent.dispatch();
      }}
    >
      <span
        aria-hidden="true"
        class={cn(
          "relative inline-block h-10 aspect-square transition-opacity duration-250",
          { "opacity-50": getFocus() },
        )}
      >
        <svg
          viewBox="0 0 512 512"
          class="h-full w-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* left + right keyboard bodies (main colour strokes) */}
          <g stroke="var(--main-color)" stroke-width="20" stroke-linejoin="round">
            <rect x="70" y="120" width="150" height="230" rx="42" />
            <rect x="292" y="120" width="150" height="230" rx="42" />
          </g>
          {/* keycaps (dim colour fills) */}
          <g fill="var(--sub-color)">
            <rect x="106" y="152" width="46" height="34" rx="10" />
            <rect x="106" y="212" width="46" height="34" rx="10" />
            <rect x="106" y="272" width="46" height="34" rx="10" />
            <rect x="360" y="152" width="46" height="34" rx="10" />
            <rect x="360" y="212" width="46" height="34" rx="10" />
            <rect x="360" y="272" width="46" height="34" rx="10" />
          </g>
          {/* P */}
          <path
            d="M 236 392 L 236 136 Q 236 108 264 108 L 300 108 Q 352 108 352 164 L 352 180 Q 352 236 300 236 L 236 236"
            stroke="var(--main-color)"
            stroke-width="38"
            stroke-linejoin="round"
          />
          {/* T */}
          <path
            d="M 268 246 L 402 246 M 356 246 L 356 392"
            stroke="var(--main-color)"
            stroke-width="38"
          />
        </svg>
      </span>
      <div class="hidden h-6 place-content-center text-[2rem] leading-0 sm:grid">
        <div
          class={cn(
            "-mt-[1.65em] hidden pl-[0.5em] text-[0.315em] leading-0 text-sub transition-colors duration-125 lg:block",
            {
              "text-transparent": getFocus(),
            },
          )}
          data-ui-element="logoSubtext"
        >
          {isDevEnvironment() ? "localhost" : "parallel typing"}
        </div>
        <h1
          class={cn("-mt-[0.11em] text-text transition-colors duration-250", {
            "text-sub": getFocus(),
          })}
          data-ui-element="logoText"
        >
          ParallelType
        </h1>
      </div>
    </Link>
  );
}
