import { CustomPunctuationStyleSchema } from "@monkeytype/schemas/configs";
import { createForm } from "@tanstack/solid-form";
import { For, JSXElement, Show } from "solid-js";
import { z } from "zod";

import { configMetadata } from "../../../../config/metadata";
import { setConfig } from "../../../../config/setters";
import { Config, getConfig } from "../../../../config/store";
import { useSavedIndicator } from "../../../../hooks/useSavedIndicator";
import { showNoticeNotification } from "../../../../states/notifications";
import { Button } from "../../../common/Button";
import { InputField } from "../../../ui/form/InputField";
import { fromSchema } from "../../../ui/form/utils";
import { SearchableSetting } from "../SearchableSetting";

const CustomPunctuationInputSchema = z.string().max(32);

/** preset rows: label → characters + zwnj default */
const PRESETS: { label: string; chars: string; zwnj: boolean }[] = [
  { label: "english", chars: "", zwnj: false },
  { label: "fa standard", chars: "،؟؛«»", zwnj: false },
];

/**
 * Custom punctuation control (idea #4): style toggle, preset rows, the
 * character input and the ZWNJ half-space toggle. The master enable/disable
 * stays the punctuation toggle; this only selects WHICH characters the
 * punctuation branches use when punctuationStyle is "custom".
 */
export function CustomPunctuation(): JSXElement {
  const savedIndicator = useSavedIndicator();

  const form = createForm(() => ({
    defaultValues: {
      customPunctuation: getConfig.customPunctuation,
    },
    onSubmit: ({ value }) => {
      const val = value.customPunctuation;
      if (val === getConfig.customPunctuation) return;
      if (val.length === 0) {
        //safe fallback: an empty set uses the built-in per-language table
        showNoticeNotification(
          "Empty set — the built-in punctuation table will be used.",
          { durationMs: 5000 },
        );
      }
      savedIndicator.flash();
      setConfig("customPunctuation", val);
    },
  }));

  const setStyle = (style: "default" | "custom"): void => {
    if (getConfig.punctuationStyle === style) return;
    setConfig("punctuationStyle", style);
  };

  const applyPreset = (preset: { chars: string; zwnj: boolean }): void => {
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", preset.chars);
    setConfig("customPunctuationZwnj", preset.zwnj);
    form.setFieldValue("customPunctuation", preset.chars);
    savedIndicator.flash();
  };

  const toggleZwnj = (): void => {
    setConfig("customPunctuationZwnj", !getConfig.customPunctuationZwnj);
  };

  return (
    <SearchableSetting
      key="customPunctuation"
      title={
        configMetadata.punctuationStyle.displayString ?? "punctuation style"
      }
      fa={configMetadata.punctuationStyle.fa}
      description={
        "Which punctuation characters the generator uses. Presets: english " +
        "(built-in table) and fa standard (،؟؛«» as paired wrappers). An " +
        "empty custom set falls back to the built-in table. Note: the " +
        "persian_standard keyboard layout has no Persian question-mark key, " +
        "and ZWNJ support differs by layout."
      }
      inputs={
        <div class="grid w-full gap-2">
          <div class="grid grid-cols-2 gap-2">
            <For each={CustomPunctuationStyleSchema.options}>
              {(style) => (
                <Button
                  text={style}
                  active={Config.punctuationStyle === style}
                  onClick={() => {
                    setStyle(style);
                  }}
                />
              )}
            </For>
          </div>
          <Show when={Config.punctuationStyle === "custom"}>
            <div class="grid grid-cols-2 gap-2">
              <For each={PRESETS}>
                {(preset) => (
                  <Button
                    text={preset.label}
                    onClick={() => {
                      applyPreset(preset);
                    }}
                  />
                )}
              </For>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <form.Field
                name="customPunctuation"
                validators={{
                  onChange: fromSchema(CustomPunctuationInputSchema),
                  onBlur: () => {
                    void form.handleSubmit();
                  },
                }}
                children={(field) => (
                  <div class="relative">
                    <InputField
                      field={field}
                      schema={CustomPunctuationInputSchema}
                      placeholder="custom punctuation characters"
                      maxLength={32}
                    />
                    <savedIndicator.component />
                  </div>
                )}
              />
            </form>
            <div class="grid grid-cols-2 gap-2">
              <Button
                text={`zwnj: ${Config.customPunctuationZwnj ? "on" : "off"}`}
                active={Config.customPunctuationZwnj}
                onClick={() => {
                  toggleZwnj();
                }}
              />
            </div>
            <div class="text-xs text-sub">
              ZWNJ (half-space) applies inside words for Persian only.
            </div>
          </Show>
        </div>
      }
    />
  );
}
