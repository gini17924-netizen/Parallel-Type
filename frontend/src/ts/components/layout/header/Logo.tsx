import { Link } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { JSXElement } from "solid-js";

import { restartTestEvent } from "../../../events/test";
import { getRoutePage } from "../../../states/router";
import { getFocus } from "../../../states/test";
import { cn } from "../../../utils/cn";
import { isDevEnvironment } from "../../../utils/env";
import ptLogoPaths from "./pt-logo-paths.json";

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
      class="-m-2 flex h-12 w-max gap-3 rounded-[0.8rem] p-2 focus-visible:**:data-[ui-element='logoSubtext']:text-transparent"
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
          "relative inline-block h-12 aspect-square transition-opacity duration-250",
          { "opacity-50": getFocus() },
        )}
      >
        <svg
          viewBox="0 0 512 512"
          class="h-full w-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* keycaps (dim colour) */}
          <g fill="var(--sub-color)">
          {ptLogoPaths.keys.map((d) => (
            <path d={d} />
          ))}
          </g>
          {/* strokes and letters (main colour) */}
          <g fill="var(--main-color)">
          {ptLogoPaths.main.map((d) => (
            <path d={d} />
          ))}
          </g>
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
