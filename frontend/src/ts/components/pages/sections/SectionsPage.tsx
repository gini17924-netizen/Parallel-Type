import { Link } from "@tanstack/solid-router";
import { For, JSXElement, Show } from "solid-js";

import { getSection } from "../../../constants/app-structure";
import { getRouter } from "../../../router/instance";

/**
 * Generic sub-section picker for one section of the home hub, driven entirely
 * by `app-structure.ts`: a new section with sub-sections immediately gets a
 * working picker page. The route's beforeLoad redirects unknown ids home.
 *
 * Params read from the router state (the same pattern as states/router.ts):
 * the installed @tanstack/solid-router useParams needs either match-internal
 * fields or a context this page wrapper does not provide.
 */
export function SectionsPage(): JSXElement {
  const section = () => {
    const match = getRouter()?.state.matches.at(-1);
    const params = match?.params as { sectionId?: string } | undefined;
    return getSection(params?.sectionId);
  };

  return (
    <Show when={section()}>
      {(section) => (
        <div class="content-grid grid place-items-center gap-8 py-10">
          <div class="text-center">
            <i class={`fas ${section().icon} text-3xl text-main`}></i>
            <div class="text-3xl font-bold text-main">{section().title}</div>
            <div class="text-sub">{section().description}</div>
          </div>
          <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
            <For each={section().subSections}>
              {(sub) => (
                <Link
                  to={sub.route}
                  class="group flex flex-col items-center gap-3 rounded bg-sub-alt p-8 text-center transition-[background,color,transform] duration-125 hover:bg-text focus-visible:outline-2 focus-visible:outline-text"
                >
                  <i
                    class={`fas ${sub.icon} text-4xl text-sub transition-colors duration-125 group-hover:text-bg`}
                  ></i>
                  <div class="text-xl font-bold text-main group-hover:text-bg">
                    {sub.title}
                  </div>
                  <div class="text-sm text-sub group-hover:text-bg">
                    {sub.description}
                  </div>
                </Link>
              )}
            </For>
          </div>
          <Link
            to="/home"
            class="flex items-center gap-2 text-sub transition-colors duration-125 hover:text-main"
          >
            <i class="fas fa-arrow-left"></i>
            back to home
          </Link>
        </div>
      )}
    </Show>
  );
}
