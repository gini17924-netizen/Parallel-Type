import { JSXElement, For, Show, createSignal, onMount } from "solid-js";

import { setConfig } from "../../../config/setters";
import { Config } from "../../../config/store";
import { restartTestEvent } from "../../../events/test";
import { loadSharedPhoneticModel } from "../../../keybr/session";
import { navigate } from "../../../router/navigate";
import { setCustomTextIndicator } from "../../../states/core";
import { showNoticeNotification } from "../../../states/notifications";
import * as CustomText from "../../../test/custom-text";
import {
  isDrillSpeechEnabled,
  setDrillSpeechEnabled,
} from "../../../utils/drill-speech";
import {
  ENTER_STAT_KEY,
  generateEnterDrillWords,
  type EnterDrillStyle,
} from "../../../utils/enter-drill";
import {
  fetchWordList,
  generateDrillWords,
  getLearnState,
  masteryPathForLanguage,
  rowDrillsForLanguage,
  rustyLetters,
  setActiveDrillWords,
  unlockedLetters,
  weakLetterDrillWords,
  weakLetters,
  weakLettersDetailed,
  type MasteryPathGroup,
} from "../../../utils/learn-stats";
import { loadKeybrLetterStats } from "../../../utils/keybr-letter-stats";
import {
  buildCurrentWeakness,
  generateSmartDrillWords,
} from "../../../utils/smart-drill";
import {
  buildSymbolDrillPlan,
  loadCodeDrillState,
} from "../../../utils/code-drill";
import {
  buildPersianPunctuationDrillWords,
  buildZwnjDrillWords,
  PERSIAN_DRILL_WORD_COUNT,
  PERSIAN_PUNCTUATION_DRILL_NAME,
  ZWNJ_DRILL_NAME,
} from "../../../utils/persian-drills";
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
  //idea #12: speak-words toggle for drills (persisted, boot-installed effect)
  const [speechOn, setSpeechOn] = createSignal(isDrillSpeechEnabled());
  //idea #9: enter-key accuracy from the learn state (undefined = never drilled)
  const [enterAccuracy, setEnterAccuracy] = createSignal<number | undefined>(
    undefined,
  );
  //phase 67: code-symbol stats (own store — never mixes with letters)
  const [codeStats, setCodeStats] = createSignal<{ total: number; weakest: string }>(
    { total: 0, weakest: "" },
  );
  //phase 70: the per-key mastery chain (mastered → current → locked)
  const [masteryPath, setMasteryPath] = createSignal<MasteryPathGroup[]>([]);

  const refreshEnterAccuracy = (): void => {
    const stat = getLearnState().keyStats[ENTER_STAT_KEY];
    if (stat === undefined) {
      setEnterAccuracy(undefined);
      return;
    }
    const total = stat.correct + stat.incorrect;
    setEnterAccuracy(total > 0 ? stat.correct / total : undefined);
  };

  const refreshCodeStats = (): void => {
    const state = loadCodeDrillState();
    const entries = Object.entries(state.symbols);
    const total = entries.reduce((sum, [, s]) => sum + s.correct + s.incorrect, 0);
    const weakest = entries
      .filter(([, s]) => s.correct + s.incorrect > 0)
      .sort((a, b) => b[1].incorrect / (b[1].correct + b[1].incorrect) - a[1].incorrect / (a[1].correct + a[1].incorrect))
      .slice(0, 5)
      .map(([ch]) => ch)
      .join(" ");
    setCodeStats({ total, weakest });
  };

  onMount(async () => {
    try {
      setWordList(await fetchWordList(language()));
    } catch {
      setWordList([]);
    }
    setWeak(weakLetters(8));
    setDetailed(weakLettersDetailed(8));
    setRusty(rustyLetters(8));
    refreshEnterAccuracy();
    refreshCodeStats();
    setMasteryPath(
      masteryPathForLanguage(getLearnState(), loadKeybrLetterStats(), language()),
    );
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

      <section class="grid gap-4 rounded bg-sub-alt p-4" data-testid="mastery-path-card">
        <div class="text-sub">mastery path (phase 70)</div>
        <div class="text-xs text-sub">
          a key masters at ≥20 correct chars with ≥95% accuracy — and
          ≤800ms/char once the keybr engine holds timing for it; the next
          group opens when the current one fully masters
        </div>
        <div class="grid gap-2">
          <For each={masteryPath()}>
            {(group) => (
              <div class="flex items-center gap-2">
                <span class="w-4 text-center">
                  {group.status === "mastered"
                    ? "✓"
                    : group.status === "current"
                      ? "→"
                      : "·"}
                </span>
                <span
                  class={`text-sm ${group.status === "locked" ? "text-sub" : ""}`}
                >
                  {group.letters}
                </span>
                <div class="flex flex-wrap gap-1">
                  <For each={group.keys}>
                    {(key) => (
                      <span
                        class={`rounded px-1 text-xs ${
                          key.mastered
                            ? "bg-main text-bg"
                            : group.status === "locked"
                              ? "bg-sub text-sub"
                              : "bg-sub text-text"
                        }`}
                        title={`acc ${(key.accuracy * 100).toFixed(0)}% · ${
                          key.samples
                        } samples${
                          key.meanMsPerChar !== undefined
                            ? ` · ${Math.round(key.meanMsPerChar)}ms/char`
                            : ""
                        }`}
                      >
                        {key.letter}
                      </span>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
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
          text={speechOn() ? "speak words: on" : "speak words: off"}
          fa={{ icon: speechOn() ? "fa-volume-up" : "fa-volume-mute" }}
          class="w-full"
          onClick={() => {
            const next = !speechOn();
            setDrillSpeechEnabled(next);
            setSpeechOn(next);
          }}
        />
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
                  //D1: register the words so the test-finish hook merges
                  //this attempt into the review schedule — the UI promises
                  //"Registered in your review schedule"
                  setActiveDrillWords(plan.words);
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
                  setActiveDrillWords(plan.words);
                  startDrill(plan.words, "smart drill");
                }
              } finally {
                setSmartLoading(false);
              }
            })();
          }}
        />
      </section>

      <section class="grid gap-4 rounded bg-sub-alt p-4" data-testid="code-symbols-card">
        <div class="text-sub">code symbols (phase 67)</div>
        <Show
          when={codeStats().total > 0}
          fallback={
            <div class="text-xs text-sub">
              type a code snippet first — every code session feeds these
              stats ({}[]();= and friends are what break code speed)
            </div>
          }
        >
          <div class="text-xs text-sub">
            weakest so far: {codeStats().weakest}
          </div>
          <Button
            text="start code symbols drill"
            fa={{ icon: "fa-code" }}
            class="w-full"
            onClick={() => {
              const plan = buildSymbolDrillPlan(loadCodeDrillState());
              //D1 pattern: register the words so the test-finish hook
              //merges this attempt into the symbol stats
              setActiveDrillWords(plan.words);
              startDrill(plan.words, "code symbols drill");
            }}
          />
        </Show>
      </section>

      <Show when={language().startsWith("persian")}>
        <section
          class="grid gap-4 rounded bg-sub-alt p-4"
          data-testid="persian-drills-card"
        >
          <div class="text-sub">specialized persian drills (phase 69)</div>
          <div class="grid grid-cols-2 gap-2">
            <Button
              text="ZWNJ drill"
              fa={{ icon: "fa-keyboard" }}
              class="w-full"
              onClick={() => {
                const words = buildZwnjDrillWords();
                startDrill(words, ZWNJ_DRILL_NAME);
              }}
            />
            <Button
              text="punctuation drill"
              fa={{ icon: "fa-quote-right" }}
              class="w-full"
              onClick={() => {
                const words = buildPersianPunctuationDrillWords(
                  PERSIAN_DRILL_WORD_COUNT,
                  Date.now(),
                  wordList(),
                );
                startDrill(words, PERSIAN_PUNCTUATION_DRILL_NAME);
              }}
            />
          </div>
          <div class="text-xs text-sub">
            the ZWNJ drill keeps half-spaces in the targets (shift+space
            types them) — everything else stays plain-typed
          </div>
        </section>
      </Show>

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

      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="text-sub">enter key practice (multiline muscle memory)</div>
        <p class="text-xs text-sub">
          Short lines that end with the Enter key — prose, code and chat shapes.
          Enter hits register in your review schedule like any letter.
        </p>
        <Show when={enterAccuracy() !== undefined}>
          <div class="text-sub">
            enter accuracy so far:{" "}
            <span
              class={
                (enterAccuracy() ?? 0) >= 0.95
                  ? "text-main"
                  : (enterAccuracy() ?? 0) >= 0.8
                    ? "text-text"
                    : "text-error"
              }
            >
              {Math.round((enterAccuracy() ?? 0) * 100)}%
            </span>
          </div>
        </Show>
        <div class="grid grid-cols-3 gap-2">
          <For
            each={
              [
                { style: "prose", label: "prose" },
                { style: "code", label: "code" },
                { style: "chat", label: "chat" },
              ] as { style: EnterDrillStyle; label: string }[]
            }
          >
            {({ style, label }) => (
              <Button
                text={label}
                class="w-full"
                onClick={() => {
                  //funbox guard: a funbox may redefine Enter (58008 turns it
                  //into a space) and would silently break the drill
                  if (Config.funbox.length > 0) {
                    showNoticeNotification(
                      "turn off funboxes to run the enter drill",
                    );
                    return;
                  }
                  const words = generateEnterDrillWords(
                    style,
                    wordList(),
                    25,
                    Date.now(),
                  );
                  if (words.length === 0) return;
                  //1:1 with the generated tokens: the stats diff is
                  //token-by-token against the input history
                  setActiveDrillWords(words);
                  startDrill(words, "enter drill");
                }}
              />
            )}
          </For>
        </div>
      </section>
    </div>
  );
}
