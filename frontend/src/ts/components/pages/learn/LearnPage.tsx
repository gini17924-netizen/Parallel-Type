import { JSXElement, Show, For, createSignal, onMount } from "solid-js";

import { Button } from "../../common/Button";
import { H2 } from "../../common/Headers";
import {
  DRILL_WORD_COUNT,
  evaluateUnlock,
  fetchWordList,
  getLearnState,
  generateDrillWords,
  groupsForLanguage,
  resetLearnState,
  unlockedLetters,
} from "../../../utils/learn-stats";
import { Config } from "../../../config/store";
import { setConfig } from "../../../config/setters";
import * as CustomText from "../../../test/custom-text";
import { setCustomTextIndicator } from "../../../states/core";
import { navigate } from "../../../router/navigate";
import { restartTestEvent } from "../../../events/test";
import { cn } from "../../../utils/cn";

function startDrill(words: string[]): void {
  setConfig("mode", "custom", { nosave: true });
  setConfig("punctuation", false, { nosave: true });
  setConfig("numbers", false, { nosave: true });
  CustomText.setText(words);
  CustomText.setLimitMode("word");
  CustomText.setLimitValue(words.length);
  CustomText.setMode("plain");
  CustomText.setPipeDelimiter(false);
  //show the on-screen keyboard during learning drills (nosave: reverts on restart)
  setConfig("keymapMode", "next", { nosave: true });
  setCustomTextIndicator({ name: "learning drill", isLong: false });
  void navigate({ to: "/" });
  restartTestEvent.dispatch();
}

export function LearnPage(): JSXElement {
  const language = () => Config.language;
  const [state, setState] = createSignal(getLearnState());
  const [drillPending, setDrillPending] = createSignal(false);
  const [wordList, setWordList] = createSignal<string[]>([]);

  const groups = () => groupsForLanguage(language());

  onMount(async () => {
    try {
      setWordList(await fetchWordList(language()));
    } catch {
      setWordList([]);
    }
  });

  const unlocked = (): string => unlockedLetters(language());
  const currentGroupLetters = (): string =>
    groups()[Math.min(state().unlockedGroups, groups().length) - 1] ?? "";

  const startLearnDrill = (): void => {
    const words = generateDrillWords(
      language(),
      unlocked(),
      wordList(),
      DRILL_WORD_COUNT,
    );
    if (words.length === 0) return;
    setDrillPending(true);
    startDrill(words);
  };

  const checkResult = (): void => {
    const newState = { ...getLearnState() };
    newState.unlockedGroups = evaluateUnlock(newState, language());
    setState(newState);
    setDrillPending(false);
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-graduation-cap" }} text="progressive learning" />
        <p class="text-sub">
          Keybr-style progressive mode: start with a few letters, unlock more
          as you master the current set. Fully offline — your per-key stats
          stay in this browser profile.
        </p>
      </section>

      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="grid gap-2">
          <div class="text-sub">unlocked letters</div>
          <div class="text-3xl tracking-[0.3em] text-main">{unlocked()}</div>
        </div>
        <Show
          when={state().unlockedGroups < groups().length}
          fallback={
            <div class="text-sub">
              All letter groups unlocked — you are in pure practice mode.
            </div>
          }
        >
          <div class="grid gap-2">
            <div class="text-sub">next group to unlock</div>
            <div class="text-3xl tracking-[0.3em] text-text">
              {currentGroupLetters()}
            </div>
          </div>
        </Show>
        <div class="text-sub">
          mastery threshold: 95% accuracy over 20+ letters of the current
          group
        </div>
      </section>

      <section class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Button
          text={drillPending() ? "drill in progress…" : "start learn drill"}
          fa={{ icon: "fa-play" }}
          class="w-full"
          disabled={drillPending()}
          onClick={() => void startLearnDrill()}
        />
        <Button
          text="register result"
          fa={{ icon: "fa-check" }}
          class="w-full"
          disabled={!drillPending()}
          onClick={checkResult}
        />
        <Button
          text="reset progress"
          fa={{ icon: "fa-trash" }}
          class="w-full"
          onClick={() => {
            resetLearnState();
            setState(getLearnState());
          }}
        />
      </section>

      <section class="rounded bg-sub-alt p-4">
        <div class="text-sub">per-key accuracy</div>
        <div class="grid grid-cols-6 gap-2 pt-4 sm:grid-cols-10">
          <For
            each={Object.entries(state().keyStats)}
            fallback={<div class="text-sub">no data yet — run a drill</div>}
          >
            {([letter, stat]) => {
              const total = stat.correct + stat.incorrect;
              const acc = Math.round((stat.correct / total) * 100);
              const color =
                acc >= 95 ? "text-main" : acc >= 80 ? "text-text" : "text-error";
              return (
                <div class="text-center">
                  <div class="text-2xl">{letter}</div>
                  <div class={cn(color)}>{acc}%</div>
                  <div class="text-xs text-sub">{total}</div>
                </div>
              );
            }}
          </For>
        </div>
      </section>
    </div>
  );
}
