import { JSXElement, For, Show, createSignal, onMount } from "solid-js";

import { setConfig } from "../../../config/setters";
import { Config } from "../../../config/store";
import { restartTestEvent } from "../../../events/test";
import { loadSharedPhoneticModel } from "../../../keybr/session";
import { navigate } from "../../../router/navigate";
import { setCustomTextIndicator } from "../../../states/core";
import * as CustomText from "../../../test/custom-text";
import {
  fetchWordList,
  generateDrillWords,
  rowDrillsForLanguage,
  rustyLetters,
  unlockedLetters,
  weakLetterDrillWords,
  weakLetters,
  weakLettersDetailed,
} from "../../../utils/learn-stats";
import {
  buildCurrentWeakness,
  generateSmartDrillWords,
} from "../../../utils/smart-drill";
import { Button } from "../../common/Button";
import { H2 } from "../../common/Headers";

function startDrill(words: string[], name: string): void {
  setConfig("mode", "custom", { nosave: true });
  setConfig("punctuation", false, { nosave: true });
  setConfig("numbers", false, { nosave: true });
  CustomText.setText(words);
  CustomText.setLimitMode("word");
  CustomText.setLimitValue(words.length);
  //sequential order: type the drill words exactly as generated
  CustomText.setMode("repeat");
  CustomText.setPipeDelimiter(false);
  //show the on-screen keyboard during learning drills (nosave: reverts on restart)
  setConfig("keymapMode", "next", { nosave: true });
  setCustomTextIndicator({ name, isLong: false });
  void navigate({ to: "/" });
  restartTestEvent.dispatch();
}

const rowDrills = (): { label: string; letters: string }[] =>
  rowDrillsForLanguage(Config.language);

export function DrillsPage(): JSXElement {
  const language = () => Config.language;
  const [wordList, setWordList] = createSignal<string[]>([]);
  const [weak, setWeak] = createSignal<{ letter: string; acc: number }[]>([]);
  const [rusty, setRusty] = createSignal<{ letter: string; acc: number }[]>([]);
  //idea #7: per-letter evidence sources for the problem-keys grid
  const [detailed, setDetailed] = createSignal<
    {
      letter: string;
      acc: number;
      evidence: { source: "drill" | "keybr"; n: number }[];
    }[]
  >([]);
  const [smartLoading, setSmartLoading] = createSignal(false);
  const [smartFallback, setSmartFallback] = createSignal(false);

  onMount(async () => {
    try {
      setWordList(await fetchWordList(language()));
    } catch {
      setWordList([]);
    }
    setWeak(weakLetters(8));
    setDetailed(weakLettersDetailed(8));
    setRusty(rustyLetters(8));
  });

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-dumbbell" }} text="drills" />
        <p class="text-sub">
          Targeted practice: drill a row, a hand, or your weakest keys. The test
          runs in custom mode with words filtered to your selection.
        </p>
      </section>

      <section class="grid gap-4">
        <div class="text-sub">row / hand drills</div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <For each={rowDrills()}>
            {(drill) => (
              <Button
                text={drill.label}
                class="w-full"
                onClick={() => {
                  const words = generateDrillWords(
                    language(),
                    drill.letters,
                    wordList(),
                    30,
                  );
                  if (words.length > 0) startDrill(words, drill.label);
                }}
              />
            )}
          </For>
        </div>
      </section>

      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="text-sub">
          my problem keys (drill history + keybr engine, merged per source)
        </div>
        <Show
          when={weak().length > 0}
          fallback={
            <div class="text-sub">
              not enough data yet — run a few tests or learn drills first
            </div>
          }
        >
          <div class="grid grid-cols-8 gap-2 sm:grid-cols-8">
            <For each={detailed()}>
              {(it) => (
                <div class="text-center">
                  <div class="text-2xl">{it.letter}</div>
                  <div
                    class={
                      it.acc >= 0.95
                        ? "text-main"
                        : it.acc >= 0.8
                          ? "text-text"
                          : "text-error"
                    }
                  >
                    {Math.round(it.acc * 100)}%
                  </div>
                  <Show when={it.evidence.length > 0}>
                    <div class="text-xs text-sub">
                      {it.evidence
                        .map((e) => (e.source === "drill" ? "d" : "k"))
                        .join("+")}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <div class="text-xs text-sub">
            d = drills · k = keybr engine (read-only)
          </div>
          <Button
            text="drill my problem keys"
            fa={{ icon: "fa-crosshairs" }}
            class="w-full"
            onClick={() => {
              const drill = weakLetterDrillWords(wordList(), 8, 30);
              if (drill.words.length > 0) {
                startDrill(drill.words, "problem keys");
              }
            }}
          />
        </Show>
      </section>

      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="text-sub">smart drill (adaptive phonetic generator)</div>
        <p class="text-xs text-sub">
          Real words and pronounceable pseudo-words weighted towards your
          weakest unlocked letters. Registered in your review schedule.
        </p>
        <Show when={smartFallback()}>
          <div class="text-xs text-sub">
            phonetic engine unavailable — this drill used the fallback generator
          </div>
        </Show>
        <Button
          text={smartLoading() ? "loading engine…" : "start smart drill"}
          fa={{ icon: "fa-brain" }}
          class="w-full"
          disabled={smartLoading()}
          onClick={() => {
            void (async () => {
              setSmartLoading(true);
              const seed = Date.now();
              const inputs = {
                allowedLetters: unlockedLetters(language()),
                wordList: wordList(),
                weakness: buildCurrentWeakness(),
              };
              if (inputs.allowedLetters === "") {
                setSmartLoading(false);
                return;
              }
              try {
                const model = await loadSharedPhoneticModel(
                  language().startsWith("persian") ? "fa" : "en",
                );
                const plan = generateSmartDrillWords({
                  model,
                  ...inputs,
                  seed,
                });
                setSmartFallback(plan.usedFallback);
                if (plan.words.length > 0) {
                  startDrill(plan.words, "smart drill");
                }
              } catch {
                //model load failed: the bigram fallback still fills the drill
                const plan = generateSmartDrillWords({
                  model: undefined,
                  ...inputs,
                  seed,
                });
                setSmartFallback(true);
                if (plan.words.length > 0) {
                  startDrill(plan.words, "smart drill");
                }
              } finally {
                setSmartLoading(false);
              }
            })();
          }}
        />
      </section>

      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="text-sub">
          rusty letters (due for review — spaced repetition)
        </div>
        <Show
          when={rusty().length > 0}
          fallback={
            <div class="text-sub">
              nothing due right now — keep drilling and letters will come back
              when their review interval expires
            </div>
          }
        >
          <div class="grid grid-cols-8 gap-2 sm:grid-cols-8">
            <For each={rusty()}>
              {(it) => (
                <div class="text-center">
                  <div class="text-2xl">{it.letter}</div>
                  <div
                    class={
                      it.acc >= 0.95
                        ? "text-main"
                        : it.acc >= 0.8
                          ? "text-text"
                          : "text-error"
                    }
                  >
                    {Math.round(it.acc * 100)}%
                  </div>
                </div>
              )}
            </For>
          </div>
          <Button
            text="review rusty letters"
            fa={{ icon: "fa-history" }}
            class="w-full"
            onClick={() => {
              const emphasize = rusty()
                .map((it) => it.letter)
                .join("");
              const words = generateDrillWords(
                language(),
                unlockedLetters(language()),
                wordList(),
                30,
                emphasize,
              );
              if (words.length > 0) startDrill(words, "rusty letters");
            }}
          />
        </Show>
      </section>
    </div>
  );
}
