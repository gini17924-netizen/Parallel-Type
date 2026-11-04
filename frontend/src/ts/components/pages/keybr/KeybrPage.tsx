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
  storeResultStats,
} from "../../../keybr/session";
import { getCharFromEvent } from "../../../test/layout-emulator";
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

  const bootSession = async (id: KeybrLanguageId): Promise<void> => {
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
    } catch (error: unknown) {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      window.localStorage.setItem("mtKeybrBootError", detail);
      console.error("keybr session failed to boot", error);
      setFailed(true);
    }
  };

  const startLessonState = (): void => {
    if (progress === undefined) return;
    // oxlint-disable-next-line solid/reactivity -- engine completion callback: setters run imperatively when a lesson finishes, not in a tracked scope
    lessonState = new LessonState(progress, (result, textInput) => {
      const lang = language();
      // oxlint-disable-next-line no-empty-function -- upstream Progress.append requires a callback; keybr progress is tracked by the engine itself
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
  };

  const publishKeyStates = (): void => {
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
  };

  const handleKeyDown = async (event: KeyboardEvent): Promise<void> => {
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
      const emulatedCodePoint = emulated.codePointAt(0);
      if (emulatedCodePoint === undefined) return;
      codePoint = emulatedCodePoint;
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
  };

  const refreshAfterInput = (): void => {
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
  };

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
    .keybr-char {
      transition: color 0.1s ease-out;
    }
    .keybr-caret {
      /* logical properties: the caret must hug the typed text on both
         directions — left of the cursor char in LTR, right of it in RTL
         (Persian). Physical border-left sat one char ahead in RTL. */
      border-inline-start: 0.14em solid var(--main-color);
      margin-inline-start: -0.07em;
      animation: keybr-caret-blink 1s step-end infinite;
    }
    @keyframes keybr-caret-blink {
      50% {
        border-color: transparent;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .keybr-caret {
        animation: none;
      }
      .keybr-char {
        transition: none;
      }
    }
  `;

  return (
    <div class="content-grid grid gap-6">
      <style>{caretStyle}</style>

      <section class="grid gap-1">
        <H2 text="keybr engine" fa={{ icon: "fa-bolt" }} />
        <p class="text-sm text-sub">
          adaptive lessons, fully offline — the engine watches every key and
          focuses on your weakest ones. new letters join as you reach the target
          speed.
        </p>
      </section>

      <section class="grid gap-1">
        <div class="text-xs font-bold tracking-widest text-sub uppercase">
          language
        </div>
        <div
          class="grid grid-cols-2 gap-1 rounded bg-sub-alt p-1"
          role="group"
          aria-label="practice language"
        >
          <For each={KEYBR_LANGUAGES}>
            {(lang) => (
              <button
                type="button"
                onClick={() => {
                  selectLanguage(lang.id);
                }}
                aria-pressed={languageId() === lang.id}
                class={`rounded p-2 transition-[background,color] duration-125 focus-visible:outline-2 focus-visible:outline-text ${
                  languageId() === lang.id
                    ? "bg-main text-bg"
                    : "text-sub hover:text-main"
                }`}
              >
                {lang.label}
              </button>
            )}
          </For>
        </div>
      </section>

      <section
        class="grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label="session statistics"
      >
        <StatCell label="lessons" value={String(lessonCount())} />
        <StatCell label="typed" value={String(typedCount())} />
        <StatCell
          label="speed"
          value={`${lastSpeed()} cpm`}
          note={`≈ ${Math.round(lastSpeed() / 5)} wpm`}
        />
        <StatCell label="accuracy" value={`${lastAccuracy()}%`} />
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
          <section
            class="grid gap-2 rounded bg-sub-alt p-6 md:p-8"
            aria-label="typing area"
          >
            <div
              class="grid gap-1 font-mono text-2xl leading-relaxed md:text-3xl"
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
                              ? "text-text"
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
            <div class="text-xs text-sub">
              type the text above — the engine watches every key
            </div>
          </section>

          <section class="grid gap-3">
            <div class="flex items-baseline justify-between">
              <div class="text-xs font-bold tracking-widest text-sub uppercase">
                character confidence
              </div>
              <div class="text-xs text-sub">
                ⚑ forced · dimmed = not yet included
              </div>
            </div>
            <div class="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-12">
              <For each={keyStates()}>
                {(key) => (
                  <div
                    class={`grid place-items-center gap-1 rounded p-2 transition-opacity duration-125 ${
                      key.isIncluded ? "bg-sub-alt" : "bg-sub-alt opacity-40"
                    }`}
                    aria-label={`${key.letter}: ${
                      key.confidence === null
                        ? "no data"
                        : `${Math.round(key.confidence * 100)}% confidence`
                    }${key.isForced ? ", forced" : ""}${
                      key.isIncluded ? "" : ", not yet included"
                    }`}
                  >
                    <div
                      class={`text-2xl ${
                        key.isForced
                          ? "text-main"
                          : key.isIncluded
                            ? "text-text"
                            : "text-sub"
                      }`}
                    >
                      {key.letter}
                    </div>
                    <div class="h-1 w-full rounded bg-bg">
                      <div
                        class="h-1 rounded bg-main"
                        style={{ width: `${(key.confidence ?? 0) * 100}%` }}
                      ></div>
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

function StatCell(props: {
  label: string;
  value: string;
  note?: string;
}): JSXElement {
  return (
    <div class="rounded bg-sub-alt px-3 py-2 text-center">
      <div class="text-xl font-bold text-main">{props.value}</div>
      <div class="text-xs text-sub">
        {props.label}
        {props.note !== undefined ? ` · ${props.note}` : ""}
      </div>
    </div>
  );
}
