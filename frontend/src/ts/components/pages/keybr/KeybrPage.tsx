import { LessonState, Progress } from "@keybr/practice-state";
import {
  JSXElement,
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../config/store";
import {
  KEYBR_LANGUAGES,
  type KeybrLanguage,
  type KeybrLanguageId,
  keybrLanguageById,
  loadKeybrSettings,
  loadStoredResults,
  makeLesson,
  resultStats,
  saveKeybrSettings,
  storeResultStats,
} from "../../../keybr/session";
import { getCharFromEvent } from "../../../test/layout-emulator";
import { Button } from "../../common/Button";
import { H2 } from "../../common/Headers";

/** Renders the vendored keybr.com guided-lesson engine with a Solid UI. */
export function KeybrPage(): JSXElement {
  const [languageId, setLanguageId] = createSignal<KeybrLanguageId>(
    (window.localStorage.getItem("mtKeybrLanguage") as KeybrLanguageId) || "fa",
  );
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [lines, setLines] = createSignal<
    { text: string; chars: { codePoint: number; attrs: number }[] }[]
  >([]);
  const [typedCount, setTypedCount] = createSignal(0);
  const [keyStates, setKeyStates] = createSignal<
    {
      letter: string;
      isIncluded: boolean;
      isForced: boolean;
      confidence: number | null;
    }[]
  >([]);
  const [lastSpeed, setLastSpeed] = createSignal(0);
  const [lastAccuracy, setLastAccuracy] = createSignal(0);
  const [lessonCount, setLessonCount] = createSignal(0);

  let settings = loadKeybrSettings();
  let lesson: Awaited<ReturnType<typeof makeLesson>> | undefined;
  let progress: Progress | undefined;
  let lessonState: LessonState | undefined;
  let lastKeyAt = 0;

  const language = (): KeybrLanguage => keybrLanguageById(languageId());

  async function bootSession(id: KeybrLanguageId): Promise<void> {
    setReady(false);
    setFailed(false);
    try {
      const lang = keybrLanguageById(id);
      settings = loadKeybrSettings();
      lesson = await makeLesson(lang, settings);
      progress = new Progress(settings, lesson);
      progress.seed(loadStoredResults(lang));
      startLessonState();
      window.localStorage.removeItem("mtKeybrBootError");
      setReady(true);
    } catch (error) {
      window.localStorage.setItem(
        "mtKeybrBootError",
        String((error as any)?.stack || error),
      );
      console.error("keybr session failed to boot", error);
      setFailed(true);
    }
  }

  function startLessonState(): void {
    if (progress === undefined) return;
    lessonState = new LessonState(progress, (result, textInput) => {
      const lang = language();
      progress?.append(result, () => {});
      storeResultStats(lang, resultStats(textInput));
      //keybr Result.speed is characters per minute
      setLastSpeed(Math.round(result.speed));
      setLastAccuracy(Math.round(result.accuracy * 1000) / 10);
      setLessonCount((c) => c + 1);
      startLessonState();
    });
    setLines(
      lessonState.lines.lines.map((line) => ({
        text: line.text,
        chars: line.chars.map((ch) => ({
          codePoint: ch.codePoint,
          attrs: ch.attrs,
        })),
      })),
    );
    setTypedCount(0);
    publishKeyStates();
  }

  function publishKeyStates(): void {
    if (lessonState === undefined) return;
    const states: {
      letter: string;
      isIncluded: boolean;
      isForced: boolean;
      confidence: number | null;
    }[] = [];
    for (const key of lessonState.lessonKeys) {
      states.push({
        letter: key.letter.label,
        isIncluded: key.isIncluded,
        isForced: key.isForced,
        confidence: key.confidence,
      });
    }
    setKeyStates(states);
  }

  async function handleKeyDown(event: KeyboardEvent): Promise<void> {
    if (!ready() || lessonState === undefined) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      lessonState.onInput({
        type: "input",
        timeStamp: performance.now(),
        inputType: "clearChar",
        codePoint: 0,
        timeToType: 0,
      });
      refreshAfterInput();
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const now = performance.now();
    const timeToType = Math.min(Math.max(now - lastKeyAt, 0), 5000);
    lastKeyAt = now;
    //respect the layout emulator exactly like the main test: with a
    //non-default layout the typed char comes from the key mapping, not
    //from the OS-produced event.key
    let codePoint: number;
    if (Config.layout !== "default") {
      const emulated = await getCharFromEvent(event);
      if (emulated === null || emulated === "") return;
      codePoint = emulated.codePointAt(0)!;
    } else {
      const raw = event.key.codePointAt(0);
      if (raw === undefined) return;
      codePoint = raw;
    }
    lessonState.onInput({
      type: "input",
      timeStamp: now,
      inputType: "appendChar",
      codePoint,
      timeToType,
    });
    refreshAfterInput();
  }

  function refreshAfterInput(): void {
    if (lessonState === undefined) return;
    setLines(
      lessonState.lines.lines.map((line) => ({
        text: line.text,
        chars: line.chars.map((ch) => ({
          codePoint: ch.codePoint,
          attrs: ch.attrs,
        })),
      })),
    );
    setTypedCount(lessonState.textInput.pos);
    if (lessonState.lastLesson !== null) {
      //a lesson completed: the state was rebuilt by onResult
      publishKeyStates();
    }
  }

  onMount(() => {
    void bootSession(languageId());
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const selectLanguage = (id: KeybrLanguageId): void => {
    setLanguageId(id);
    window.localStorage.setItem("mtKeybrLanguage", id);
    void bootSession(id);
  };

  const caretStyle = `
    .keybr-caret {
      border-left: 0.12em solid var(--main-color);
      margin-left: -0.06em;
      animation: keybr-caret-blink 1s step-end infinite;
    }
    @keyframes keybr-caret-blink {
      50% {
        border-color: transparent;
      }
    }
  `;

  return (
    <div class="content-grid grid gap-8">
      <style>{caretStyle}</style>
      <section>
        <H2 text="keybr engine" fa={{ icon: "fa-bolt" }} />
        <p class="text-sub">
          The keybr.com adaptive lesson engine, fully offline: lessons focus on
          your weakest keys, new letters join as you reach the target speed.
          Pick a language and just type.
        </p>
      </section>

      <section class="grid gap-2">
        <div class="text-sub">language</div>
        <div class="grid grid-cols-2 gap-2">
          <For each={KEYBR_LANGUAGES}>
            {(lang) => (
              <Button
                text={lang.label}
                class={`w-full ${languageId() === lang.id ? "bg-main text-bg" : ""}`}
                onClick={() => {
                  selectLanguage(lang.id);
                }}
              />
            )}
          </For>
        </div>
      </section>

      <Show
        when={!failed()}
        fallback={
          <div class="rounded bg-sub-alt p-4 text-error">
            Failed to load the keybr engine session.
          </div>
        }
      >
        <Show
          when={ready()}
          fallback={<div class="text-sub">loading engine…</div>}
        >
          <section class="grid gap-4 rounded bg-sub-alt p-4">
            <div class="flex items-baseline justify-between">
              <div class="text-sub">
                lessons: {lessonCount()} · typed: {typedCount()}
              </div>
              <div class="text-sub">
                speed: {lastSpeed()} cpm (≈ {Math.round(lastSpeed() / 5)} wpm) ·
                accuracy: {lastAccuracy()}%
              </div>
            </div>
            <div
              class="grid gap-1 font-mono text-2xl leading-relaxed"
              dir="auto"
            >
              <For each={lines()}>
                {(line) => (
                  <div class="break-words whitespace-pre-wrap">
                    <For each={line.chars}>
                      {(ch) => {
                        const hit = (ch.attrs & 1) !== 0; //Attr.Hit
                        const miss = (ch.attrs & 2) !== 0; //Attr.Miss
                        const garbage = (ch.attrs & 4) !== 0; //Attr.Garbage
                        const caret = (ch.attrs & 8) !== 0; //Attr.Cursor
                        const cls =
                          miss || garbage
                            ? "text-error"
                            : hit
                              ? "text-main"
                              : "text-sub";
                        return (
                          <span
                            class={`keybr-char ${cls} ${caret ? "keybr-caret" : ""} ${garbage ? "line-through opacity-80" : ""}`}
                          >
                            {String.fromCodePoint(ch.codePoint)}
                          </span>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </div>
            <div class="text-sub">
              type the text above — the engine watches every key
            </div>
          </section>

          <section class="grid gap-4 rounded bg-sub-alt p-4">
            <div class="text-sub">lesson keys (confidence → target speed)</div>
            <div class="grid grid-cols-6 gap-2 sm:grid-cols-12">
              <For each={keyStates()}>
                {(key) => (
                  <div class="text-center">
                    <div
                      class={
                        key.isIncluded
                          ? "text-2xl text-main"
                          : "text-2xl text-sub opacity-40"
                      }
                    >
                      {key.letter}
                    </div>
                    <div class="text-xs text-sub">
                      {key.confidence === null
                        ? "—"
                        : `${Math.round(key.confidence * 100)}%`}
                      {key.isForced ? " ⚑" : ""}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}
