import { createSignal, For, JSXElement, Show } from "solid-js";
import { debounce } from "throttle-debounce";
import { z } from "zod";

import { configMetadata } from "../../../../config/metadata";
import { setConfig } from "../../../../config/setters";
import { getConfig } from "../../../../config/store";
import {
  ColorName,
  ThemesList,
  ThemeWithName,
} from "../../../../constants/themes";
import {
  convertCustomColorsToTheme,
  convertThemeToCustomColors,
} from "../../../../controllers/theme-controller";
import { createEffectOn } from "../../../../hooks/effects";
import {
  showErrorNotification,
  showNoticeNotification,
  showSuccessNotification,
} from "../../../../states/notifications";
import { showSimpleModal } from "../../../../states/simple-modal";
import { getTheme, setTheme, updateThemeColor } from "../../../../states/theme";
import { buildCustomThemeLink } from "../../../../url-actions/actions/custom-theme";
import { cn } from "../../../../utils/cn";
import { hexToHSL } from "../../../../utils/colors";
import { replaceUnderscoresWithSpaces } from "../../../../utils/strings";
import {
  buildCustomThemeFile,
  deleteLocalCustomTheme,
  downloadCustomThemeFile,
  listLocalCustomThemes,
  normalizeThemeName,
  saveLocalCustomTheme,
  validateCustomThemeFile,
  type LocalCustomTheme,
} from "../../../../utils/themes/custom-themes";
import { AnimeSwitch } from "../../../common/anime";
import { AnimeMatch } from "../../../common/anime/AnimeMatch";
import { Button } from "../../../common/Button";
import { Fa } from "../../../common/Fa";
import { Separator } from "../../../common/Separator";
import { ThemeBubbles } from "../../../common/ThemeBubbles";
import { SearchableSetting } from "../SearchableSetting";

export const sortedThemes: ThemeWithName[] = [...ThemesList].sort((a, b) => {
  const b1 = hexToHSL(a.bg);
  const b2 = hexToHSL(b.bg);
  return b2.lgt - b1.lgt;
});

export function Theme(): JSXElement {
  //phase 92: the LOCAL named custom themes (the account collection is
  //auth-gated and the desktop fork boots signed-out, so the upstream
  //"save as new" was dead code here). a signal so save/delete re-render.
  const [localThemes, setLocalThemes] = createSignal(listLocalCustomThemes());
  const refreshLocalThemes = (): void => {
    setLocalThemes(listLocalCustomThemes());
  };
  // oxlint-disable-next-line eslint/no-unassigned-vars -- Solid ref binding assigns this in JSX
  let importInputRef: HTMLInputElement | undefined;

  const saveNamed = (): void => {
    showSimpleModal({
      title: "Save custom theme",
      schema: z.object({ name: z.string().min(1).max(80) }),
      inputs: {
        name: {
          type: "text",
          initVal: "my theme",
        },
      },
      buttonText: "save",
      execFn: async ({ name }) => {
        if (name === undefined || normalizeThemeName(name) === "") {
          return { status: "error", message: "Name is required" };
        }
        const ok = saveLocalCustomTheme(name, getTheme());
        if (!ok) {
          return {
            status: "error",
            message: "Empty name or the custom theme limit reached",
          };
        }
        refreshLocalThemes();
        return { status: "success", message: "Custom theme saved" };
      },
    });
  };

  const importTheme = (file: File): void => {
    void (async () => {
      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const themeFile = validateCustomThemeFile(parsed);
        if (themeFile === undefined) {
          showErrorNotification("not a valid theme file");
          return;
        }
        const ok = saveLocalCustomTheme(themeFile.name, themeFile.colors);
        if (!ok) {
          showErrorNotification("empty name or the custom theme limit reached");
          return;
        }
        refreshLocalThemes();
        showSuccessNotification(`theme imported: ${themeFile.name}`);
      } catch {
        showErrorNotification("failed to load the theme file");
      }
    })();
  };

  const exportCurrent = (): void => {
    const current = getTheme();
    const name = current.name === "custom" ? "custom theme" : current.name;
    downloadCustomThemeFile(buildCustomThemeFile(name, current));
  };

  const Presets = () => (
    <div class="grid gap-4">
      <Show when={getConfig.favThemes.length > 0}>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2">
          <For
            each={sortedThemes.filter((t) =>
              getConfig.favThemes.includes(t.name),
            )}
          >
            {(theme) => <ThemeButton theme={theme} />}
          </For>
        </div>
      </Show>
      <Show when={getConfig.favThemes.length > 0}>
        <Separator />
      </Show>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2">
        <For
          each={sortedThemes.filter(
            (t) => !getConfig.favThemes.includes(t.name),
          )}
        >
          {(theme) => <ThemeButton theme={theme} />}
        </For>
      </div>
    </div>
  );

  const Customs = () => (
    <div class="grid gap-4">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2">
        <For each={localThemes()}>
          {(theme) => (
            <LocalCustomThemeButton
              theme={theme}
              onChanged={refreshLocalThemes}
            />
          )}
        </For>
      </div>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Picker color="bg" />
        <Picker color="main" />
        <Picker color="sub" />
        <Picker color="text" />
        <Picker color="caret" />
        <Picker color="subAlt" />
        <Picker color="error" />
        <Picker color="errorExtra" />
        <div class="col-span-1 text-sub md:col-span-2">
          when colorful mode is enabled:
        </div>
        <Picker color="colorfulError" />
        <Picker color="colorfulErrorExtra" />
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          text="load from preset"
          onClick={() => {
            const presetTheme = ThemesList.find(
              (t) => t.name === getConfig.theme,
            );
            if (presetTheme) {
              setTheme({ ...presetTheme, name: "custom" });
            } else {
              showErrorNotification(
                "Current preset theme not found. How is this possible?",
              );
            }
          }}
        />
        <Button
          text="share"
          onClick={() => {
            showSimpleModal({
              title: "Share custom theme",
              schema: z.object({ includeBackground: z.boolean().optional() }),
              inputs: {
                includeBackground: {
                  label: "Include background link, size and filters",
                  type: "checkbox",
                },
              },
              buttonText: "copy link to clipboard",
              buttonAlwaysEnabled: true,
              execFn: async ({ includeBackground }) => {
                const link = buildCustomThemeLink({
                  colors: convertThemeToCustomColors(getTheme()),
                  background: includeBackground
                    ? {
                        image: getConfig.customBackground,
                        size: getConfig.customBackgroundSize,
                        filter: getConfig.customBackgroundFilter,
                      }
                    : undefined,
                });

                try {
                  await navigator.clipboard.writeText(link);
                  showSuccessNotification("URL Copied to clipboard");
                } catch (e) {
                  showNoticeNotification(
                    "Looks like we couldn't copy the link straight to your clipboard. Please copy it manually.",
                    {
                      durationMs: 5000,
                    },
                  );

                  setTimeout(() => {
                    showSimpleModal({
                      title: "Custom theme URL",
                      class: "max-w-2xl",
                      schema: z.object({ url: z.string() }),
                      inputs: {
                        url: {
                          type: "textarea",
                          placeholder: "URL",
                          initVal: link,
                          clickToSelect: true,
                          readOnly: true,
                          class: "h-50",
                        },
                      },
                      execFn: async () => {
                        return {
                          status: "success",
                          showNotification: false,
                        };
                      },
                    });
                  }, 250);
                  // this is flaky, no chaining for simple modals
                }

                return {
                  status: "success",
                  showNotification: false,
                };
              },
            });
          }}
        />
        <Button
          text="save as named"
          fa={{ icon: "fa-save" }}
          onClick={saveNamed}
        />
        <Button
          text="import theme"
          fa={{ icon: "fa-file-import" }}
          onClick={() => {
            importInputRef?.click();
          }}
        />
        <Button
          text="export current"
          fa={{ icon: "fa-file-export" }}
          onClick={exportCurrent}
        />
        <Button
          text="save"
          onClick={() => {
            setConfig(
              "customThemeColors",
              convertThemeToCustomColors(getTheme()),
            );
            showSuccessNotification("Custom theme colors saved");
          }}
        />
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        class="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file === undefined) return;
          importTheme(file);
        }}
      />
    </div>
  );

  createEffectOn(
    () => getConfig.customTheme,
    (custom) => {
      if (custom) {
        const colorsObj = convertCustomColorsToTheme(
          getConfig.customThemeColors,
        );
        setTheme({ ...colorsObj, name: "custom" });
      }
    },
  );

  return (
    <SearchableSetting
      key="theme"
      title={configMetadata.theme.displayString ?? "theme"}
      fa={configMetadata.theme.fa}
      description={configMetadata.theme.description}
      inputs={
        <div class="grid w-full grid-cols-2 gap-2">
          <Button
            onClick={() => setConfig("customTheme", false)}
            active={!getConfig.customTheme}
            text="preset"
          />
          <Button
            onClick={() => setConfig("customTheme", true)}
            active={getConfig.customTheme}
            text="custom"
          />
        </div>
      }
      fullWidthInputs={
        // <AnimeConditional
        //   exitBeforeEnter
        //   if={!getConfig.customTheme}
        //   then={<Presets />}
        //   else={<Customs />}
        // />
        // <AnimePresence exitBeforeEnter>

        //   </AnimePresence>
        <AnimeSwitch
          exitBeforeEnter
          animeProps={{
            initial: {
              opacity: 0,
              duration: 125,
            },
            animate: {
              opacity: 1,
              duration: 125,
            },
            exit: {
              opacity: 0,
              duration: 125,
            },
          }}
        >
          <AnimeMatch when={!getConfig.customTheme}>
            <Presets />
          </AnimeMatch>
          <AnimeMatch when={getConfig.customTheme}>
            <Customs />
          </AnimeMatch>
        </AnimeSwitch>
      }
    />
  );
}

function LocalCustomThemeButton(props: {
  theme: LocalCustomTheme;
  onChanged: () => void;
}): JSXElement {
  const themeColors = () => props.theme.colors;

  return (
    <button
      type="button"
      style={{
        "--bg": themeColors().bg,
        "--main": themeColors().main,
        "--sub": themeColors().sub,
        "--text": themeColors().text,
      }}
      class={cn(
        "group/theme grid grid-cols-[auto_1fr_auto] justify-between p-0 ring-4 ring-transparent",
        "bg-(--bg) text-(--main)",
        "hover:ring-(--main)",
        "transition-[opacity,color,background,box-shadow] duration-125",
      )}
      onClick={() => {
        setConfig(
          "customThemeColors",
          convertThemeToCustomColors(themeColors()),
        );
      }}
      data-theme-id={props.theme.name}
    >
      <Button
        variant="text"
        fa={{
          icon: "fa-file-export",
          fixedWidth: true,
        }}
        class={cn(
          "mx-1 p-2",
          "[--themable-button-hover-text:var(--main)] [--themable-button-text:var(--sub)]",
          "opacity-0 group-hover/theme:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          downloadCustomThemeFile(
            buildCustomThemeFile(props.theme.name, themeColors()),
          );
        }}
      />
      <div>{props.theme.name}</div>
      <Button
        variant="text"
        fa={{
          icon: "fa-trash",
          fixedWidth: true,
        }}
        class={cn(
          "mx-1 p-2",
          "[--themable-button-hover-text:var(--main)] [--themable-button-text:var(--sub)]",
          "opacity-0 group-hover/theme:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          showSimpleModal({
            title: "Delete custom theme",
            text: `Are you sure you want to delete the custom theme "${props.theme.name}"? This action cannot be undone.`,
            buttonText: "delete",
            execFn: async () => {
              deleteLocalCustomTheme(props.theme.name);
              props.onChanged();
              return {
                status: "success",
                message: "Custom theme deleted",
              };
            },
          });
        }}
      />
    </button>
  );
}

// rendered ~200 times on the settings page - kept to as few elements and
// reactive bindings as possible
function ThemeButton(props: { theme: ThemeWithName }): JSXElement {
  const isActive = () => getConfig.theme === props.theme.name;
  const isFav = () => getConfig.favThemes.includes(props.theme.name);

  return (
    <button
      type="button"
      style={{
        "--bg": props.theme.bg,
        "--main": props.theme.main,
        "--sub": props.theme.sub,
        "--text": props.theme.text,
      }}
      class={cn(
        "group/theme grid grid-cols-[1fr_auto_1fr] justify-between p-1 ring-4 ring-transparent",
        "bg-(--bg) text-(--main)",
        // "hover:bg-(--text) hover:text-(--bg)",
        "hover:ring-(--main)",
        "transition-[opacity,color,background,box-shadow] duration-125",
        isActive() && "ring-4 ring-(--main)",
      )}
      onClick={() => {
        if (isActive()) return;
        setConfig("theme", props.theme.name);
      }}
    >
      <div
        class={cn(
          "grid place-self-start rounded-full bg-(--bg) p-1 opacity-0 transition-[opacity,color] duration-125 group-hover/theme:opacity-100 hover:text-(--text)",
          isFav() && "opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (isFav()) {
            setConfig(
              "favThemes",
              getConfig.favThemes.filter((t) => t !== props.theme.name),
            );
          } else {
            setConfig("favThemes", [...getConfig.favThemes, props.theme.name]);
          }
        }}
      >
        <Fa icon="fa-star" variant={isFav() ? "solid" : "regular"} fixedWidth />
      </div>
      <div>{replaceUnderscoresWithSpaces(props.theme.name)}</div>
      <ThemeBubbles
        inset={false}
        colors={props.theme}
        class={cn(
          "mr-1 place-self-end self-center opacity-0 transition-opacity duration-125 group-hover/theme:opacity-100",
          isActive() && "opacity-100",
        )}
      />
    </button>
  );
}

function Picker(props: { color: ColorName }): JSXElement {
  let colorInputRef: HTMLInputElement | undefined = undefined;

  const text = () => {
    if (props.color === "bg") return "background";
    if (props.color === "main") return "main";
    if (props.color === "sub") return "sub";
    if (props.color === "subAlt") return "sub alt";
    if (props.color === "caret") return "caret";
    if (props.color === "text") return "text";
    if (props.color === "error") return "error";
    if (props.color === "errorExtra") return "extra error";
    if (props.color === "colorfulError") return "error";
    if (props.color === "colorfulErrorExtra") return "extra error";
    return "unknown";
  };

  const _classes = [
    "bg-(--picker-bg)",
    "bg-(--picker-main)",
    "bg-(--picker-caret)",
    "bg-(--picker-sub)",
    "bg-(--picker-subAlt)",
    "bg-(--picker-text)",
    "bg-(--picker-error)",
    "bg-(--picker-errorExtra)",
    "bg-(--picker-colorfulError)",
    "bg-(--picker-colorfulErrorExtra)",
  ];

  // oxlint-disable-next-line solid/reactivity
  const debouncedInput = debounce(125, (e: InputEvent) => {
    const target = e.target as HTMLInputElement;
    const color = target.value;
    const key = props.color;

    updateThemeColor(key, color);
  });

  return (
    <div
      class="grid w-full grid-cols-[1fr_1fr_min-content] items-center gap-2"
      style={{
        "--picker-bg": getTheme().bg,
        "--picker-main": getTheme().main,
        "--picker-caret": getTheme().caret,
        "--picker-sub": getTheme().sub,
        "--picker-subAlt": getTheme().subAlt,
        "--picker-text": getTheme().text,
        "--picker-error": getTheme().error,
        "--picker-errorExtra": getTheme().errorExtra,
        "--picker-colorfulError": getTheme().colorfulError,
        "--picker-colorfulErrorExtra": getTheme().colorfulErrorExtra,
      }}
    >
      <div>{text()}</div>
      <input
        class="w-full"
        type="text"
        value={getTheme()[props.color]}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (!/^#([0-9A-Fa-f]{3}){1,2}$/.test(value)) {
            // invalid hex color
            e.currentTarget.value = getTheme()[props.color];
            return;
          }
          updateThemeColor(props.color, value);
        }}
      />
      <div class="grid">
        <input
          ref={(el) => (colorInputRef = el)}
          type="color"
          value={getTheme()[props.color]}
          onInput={debouncedInput}
          class="pointer-events-none col-[1/1] row-[1/1] m-0 h-full w-0 p-0 opacity-0"
          // onChange={(e) => {
          //   const current = [...getConfig.customThemeColors];
          //   current[colorIndex()] = e.currentTarget.value;
          //   setConfig(
          //     "customThemeColors",
          //     current as typeof getConfig.customThemeColors,
          //   );
          // }}
        />
        <Button
          class={cn(
            `col-[1/1] row-[1/1]`,
            `bg-(--picker-${props.color}) text-(--picker-bg)`,
            `hover:bg-(--picker-text)`,
            props.color === "bg" && "bg-(--picker-subAlt) text-(--picker-text)",
            props.color === "subAlt" && "text-(--picker-text)",
          )}
          fa={{
            icon: "fa-palette",
            fixedWidth: true,
          }}
          onClick={() => colorInputRef?.click()}
        />
      </div>
    </div>
  );
}
