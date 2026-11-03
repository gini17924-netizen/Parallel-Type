import { Link } from "@tanstack/solid-router";
import { For, JSXElement } from "solid-js";

import {
  APP_SECTIONS,
  sectionDestination,
} from "../../../constants/app-structure";

/**
 * The home hub: the app's start screen with one card per section. Sections
 * with several sub-sections open the picker, single-destination sections
 * link straight to their route (see app-structure.ts).
 */
export function HomePage(): JSXElement {
  return (
    <div class="content-grid grid place-items-center gap-8 py-10">
      <div class="text-center">
        <div class="text-3xl font-bold text-main">ParallelType</div>
        <div class="text-sub">where do you want to type today?</div>
      </div>
      <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
        <For each={APP_SECTIONS}>
          {(section) => (
            <Link
              to={sectionDestination(section)}
              class="group flex flex-col items-center gap-3 rounded bg-sub-alt p-8 text-center transition-[background,color,transform] duration-125 hover:bg-text focus-visible:outline-2 focus-visible:outline-text"
            >
              <i
                class={`fas ${section.icon} text-4xl text-sub transition-colors duration-125 group-hover:text-bg`}
              ></i>
              <div class="text-xl font-bold text-main group-hover:text-bg">
                {section.title}
              </div>
              <div class="text-sm text-sub group-hover:text-bg">
                {section.description}
              </div>
            </Link>
          )}
        </For>
      </div>
    </div>
  );
}
