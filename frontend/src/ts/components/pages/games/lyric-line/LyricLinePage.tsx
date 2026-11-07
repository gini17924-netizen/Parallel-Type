import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { playClick, playError } from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { parseLrc, type ParsedLrc } from "../../../../utils/lyric-line/lrc";
import {
  createLyricSession,
  type LyricSession,
  type LyricSessionState,
} from "../../../../utils/lyric-line/session";
import {
  getLyricSessions,
  recordLyricSession,
} from "../../../../utils/lyric-line/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the audio file size above which the page warns (doc §۵) */
const SIZE_WARN_MB = 50;

type PagePhase = "setup" | "playing" | "summary" | "voided";

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Lyric Line (idea G20, phase 2): karaoke typing over the USER'S OWN
 * audio + lyric files (session-only — nothing about the media ever
 * persists). The audio element plays a data: URL (the CSP already
 * allows it); the session's clock is the audio clock. Pause is
 * button-only (every key is a character); Enter skips the active line.
 */
export function LyricLinePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("setup");
  const [songName, setSongName] = createSignal("");
  const [audioName, setAudioName] = createSignal("");
  const [lyricsName, setLyricsName] = createSignal("");
  const [sessionState, setSessionState] = createSignal<
    LyricSessionState | undefined
  >(undefined);
  const [paused, setPaused] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  const [nowPlayingSec, setNowPlayingSec] = createSignal(0);
  const [durationSec, setDurationSec] = createSignal(0);

  let audioFile: File | undefined;
  let lyricsFile: File | undefined;
  let session: LyricSession | undefined;
  let audioEl: HTMLAudioElement | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  const detachAudio = (): void => {
    audioEl?.pause();
    audioEl?.remove();
    audioEl = undefined;
  };

  onCleanup(() => {
    stopTimers();
    detachAudio();
  });

  const onAudioPick = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    audioFile = file;
    setAudioName(file.name);
    if (songName().trim() === "") {
      setSongName(file.name.replace(/\.[^.]+$/, ""));
    }
    if (file.size > SIZE_WARN_MB * 1024 * 1024) {
      setMessage(
        `large file (${Math.round(file.size / 1024 / 1024)}MB) — it may take a moment to load`,
      );
    } else {
      setMessage(undefined);
    }
  };

  const onLyricsPick = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    lyricsFile = file;
    setLyricsName(file.name);
  };

  const readFileAs = async (
    file: File,
    as: "text" | "dataUrl",
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      if (as === "text") {
        reader.onload = () => {
          const result = reader.result;
          resolve(typeof result === "string" ? result : "");
        };
        reader.readAsText(file, "utf-8");
      } else {
        reader.onload = () => {
          const result = reader.result;
          resolve(typeof result === "string" ? result : "");
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const startSession = async (): Promise<void> => {
    if (audioFile === undefined || lyricsFile === undefined) {
      setMessage("pick both an audio file and a lyrics file first");
      return;
    }
    setMessage(undefined);
    try {
      const [lyricsText, audioUrl] = await Promise.all([
        readFileAs(lyricsFile, "text"),
        readFileAs(audioFile, "dataUrl"),
      ]);
      const parsed: ParsedLrc = parseLrc(lyricsText);
      if (parsed.lines.every((line) => line.text === "")) {
        setMessage("the lyrics file looks empty");
        return;
      }
      session = createLyricSession(parsed);
      setSessionState(session.state());
      audioEl = new Audio(audioUrl);
      //attached (hidden) so the element lives in the document like a
      //real player would
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      audioEl.onloadedmetadata = () => {
        setDurationSec(audioEl?.duration ?? 0);
      };
      audioEl.onended = () => {
        if (session === undefined) return;
        const state = session.finish();
        setSessionState(state);
        endSession(state.phase === "done");
      };
      audioEl.onerror = () => {
        setMessage("the audio format is not supported by this system");
        backToSetup();
      };
      setPagePhase("playing");
      tickTimer = setInterval(() => {
        if (session === undefined || audioEl === undefined) return;
        const state = session.tick(audioEl.currentTime);
        setSessionState(state);
        setNowPlayingSec(audioEl.currentTime);
        if (state.phase === "voided") {
          stopTimers();
          setPagePhase("voided");
        }
      }, TICK_MS);
      await audioEl.play().catch(() => {
        setMessage("the browser refused to start playback — click play");
      });
    } catch {
      setMessage("reading the files failed");
    }
  };

  const endSession = (record: boolean): void => {
    stopTimers();
    audioEl?.pause();
    if (record) {
      const state = session?.state();
      if (state?.summary !== undefined) {
        recordLyricSession({
          songName: songName().trim() || audioName() || "untitled",
          lines: state.summary.typedLines,
          acc: state.summary.acc,
          syncScore: state.summary.syncScore,
        });
      }
    }
    setPagePhase(record ? "summary" : "voided");
  };

  const togglePause = (): void => {
    if (audioEl === undefined) return;
    if (paused()) {
      void audioEl.play().catch(() => undefined);
      setPaused(false);
    } else {
      audioEl.pause();
      setPaused(true);
    }
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing" || paused()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const before = session?.state();
      const state = session?.skipLine();
      if (state !== undefined) setSessionState(state);
      if (
        (before?.lines.filter((it) => it.state === "skipped").length ?? 0) <
        (state?.lines.filter((it) => it.state === "skipped").length ?? 0)
      ) {
        void playClick();
      }
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = session?.state();
    const state = session?.feedKey(event.key);
    if (state === undefined) return;
    setSessionState(state);
    const line = state.lines[state.activeIndex];
    const lineBefore = before?.lines[before.activeIndex];
    if (lineBefore !== undefined && line?.state === "done") {
      void playClick();
    } else if (
      lineBefore !== undefined &&
      line?.state === "active" &&
      state.typed === 0 &&
      before?.typed !== 0
    ) {
      void playError();
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const backToSetup = (): void => {
    stopTimers();
    detachAudio();
    session = undefined;
    audioFile = undefined;
    lyricsFile = undefined;
    setAudioName("");
    setLyricsName("");
    setSessionState(undefined);
    setPaused(false);
    setPagePhase("setup");
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getLyricSessions().length}
            </div>
            <div class="text-xs text-sub">sessions</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xs text-sub">
              {getLyricSessions()[0] !== undefined
                ? `last: ${getLyricSessions()[0]?.songName}`
                : "nothing yet"}
            </div>
          </div>
        </div>
        <label class="grid gap-1 text-xs text-sub">
          audio file (stays on this device, never saved)
          <input
            type="file"
            accept="audio/*"
            class="rounded bg-bg p-2 text-main"
            onChange={onAudioPick}
            data-testid="ll-audio-input"
          />
          {audioName()}
        </label>
        <label class="grid gap-1 text-xs text-sub">
          lyrics file (.lrc with timestamps, or plain text)
          <input
            type="file"
            accept=".lrc,.txt,text/plain"
            class="rounded bg-bg p-2 text-main"
            onChange={onLyricsPick}
            data-testid="ll-lyrics-input"
          />
          {lyricsName()}
        </label>
        <label class="grid gap-1 text-xs text-sub">
          session name
          <input
            class="rounded bg-bg p-2 text-main"
            value={songName()}
            maxLength={60}
            placeholder="song title"
            onInput={(e) => setSongName(e.currentTarget.value)}
          />
        </label>
        <Button
          text="start session"
          fa={{ icon: "fa-music" }}
          class="w-full"
          onClick={() => void startSession()}
        />
        <div class="text-xs text-sub">
          the song plays and the lines light up with it — type the active line
          before the next one starts. with .lrc timestamps your timing scores
          (sync); plain text scores accuracy only. Enter skips instrumental
          gaps. files live in memory only.
        </div>
      </section>
    );
  };

  const Karaoke = (): JSXElement => {
    //KI-34: the session reads are FUNCTIONS called inline in the JSX —
    //body consts would freeze the karaoke on the mount snapshot
    const lines = (): LyricSessionState["lines"] => sessionState()?.lines ?? [];
    const activeIndex = (): number => sessionState()?.activeIndex ?? 0;
    const typed = (): number => sessionState()?.typed ?? 0;
    return (
      <div class="grid gap-1 rounded bg-sub-alt p-4" data-testid="ll-karaoke">
        <For
          each={lines().slice(
            Math.max(0, activeIndex() - 2),
            activeIndex() + 3,
          )}
        >
          {(line) => {
            const index = lines().indexOf(line);
            const isActive = index === activeIndex() && line.state === "active";
            return (
              <div
                class={cn(
                  "text-center leading-relaxed",
                  isActive && "text-2xl font-bold text-main",
                  !isActive &&
                    line.state === "done" &&
                    "text-sm text-sub opacity-50",
                  !isActive &&
                    line.state === "skipped" &&
                    "text-sm text-sub line-through opacity-40",
                  !isActive && line.state === "pending" && "text-sm text-sub",
                )}
                dir="auto"
                data-testid="ll-line"
                data-state={line.state}
              >
                <Show when={isActive} fallback={line.text || "· · ·"}>
                  <span>{line.text.slice(0, typed())}</span>
                  <span class="text-sub">{line.text.slice(typed())}</span>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    );
  };

  const Progress = (): JSXElement => {
    const pct = (): number => {
      const duration = durationSec() || 1;
      return Math.min(100, (nowPlayingSec() / duration) * 100);
    };
    return (
      <div class="h-1.5 w-full rounded bg-bg">
        <div
          class="h-full rounded bg-main"
          style={{ width: `${pct()}%` }}
          data-testid="ll-progress"
        ></div>
      </div>
    );
  };

  const Player = (): JSXElement => {
    const st = sessionState();
    const timed = st?.isTimed ?? false;
    const scored = st?.lines.filter((line) => line.state === "done") ?? [];
    const syncSoFar = (): number => {
      const values = scored
        .map((line) => line.syncScore)
        .filter((it): it is number => it !== undefined);
      return values.length === 0
        ? 0
        : Math.round(values.reduce((sum, it) => sum + it, 0) / values.length);
    };
    const accSoFar = (): number => {
      const values = scored.map((line) => line.acc);
      return values.length === 0
        ? 100
        : values.reduce((sum, it) => sum + it, 0) / values.length;
    };
    return (
      <div class="grid gap-4">
        <div class="grid grid-cols-3 gap-2" aria-label="lyric line hud">
          <HudCell
            label="line"
            value={`${Math.min((st?.activeIndex ?? 0) + 1, st?.lines.length ?? 1)}/${st?.lines.length ?? 0}`}
          />
          <HudCell label="acc" value={`${accSoFar().toFixed(0)}%`} />
          <HudCell
            label={timed ? "sync" : "free mode"}
            value={timed ? `${syncSoFar()}` : "—"}
          />
        </div>
        <Karaoke />
        <Progress />
        <div class="grid grid-cols-2 gap-2">
          <Button
            text={paused() ? "resume" : "pause"}
            fa={{ icon: paused() ? "fa-play" : "fa-pause" }}
            class="w-full"
            onClick={togglePause}
          />
          <Button
            text="give up"
            fa={{ icon: "fa-times" }}
            class="w-full"
            onClick={() => {
              session?.finish();
              endSession(true);
            }}
          />
        </div>
        <div class="text-center text-xs text-sub">
          type the highlighted line — Enter skips an instrumental gap
        </div>
      </div>
    );
  };

  const SummaryScreen = (): JSXElement => {
    const summary = session?.state().summary;
    const timed = session?.state().isTimed ?? false;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-main">session complete</div>
        <Show when={timed}>
          <div class="text-lg font-bold text-main">
            sync score {summary?.syncScore ?? 0}
          </div>
          <div class="text-xs text-sub">
            average lateness {((summary?.avgLatenessMs ?? 0) / 1000).toFixed(2)}
            s
          </div>
        </Show>
        <Show when={!timed}>
          <div class="text-xs text-sub">
            plain lyrics — accuracy only (no timing to score against)
          </div>
        </Show>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {summary?.lines ?? 0}
            </div>
            <div class="text-xs text-sub">lines</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {summary?.typedLines ?? 0}
            </div>
            <div class="text-xs text-sub">typed</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {summary?.skippedLines ?? 0}
            </div>
            <div class="text-xs text-sub">skipped</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {(summary?.acc ?? 0).toFixed(0)}%
            </div>
            <div class="text-xs text-sub">accuracy</div>
          </div>
        </div>
        <Button
          text="new session"
          fa={{ icon: "fa-music" }}
          class="w-full"
          onClick={backToSetup}
        />
      </section>
    );
  };

  const VoidedScreen = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-2xl font-bold text-error">
          the session was voided (the audio jumped mid-run)
        </div>
        <div class="text-xs text-sub">nothing was recorded</div>
        <Button
          text="new session"
          fa={{ icon: "fa-music" }}
          class="w-full"
          onClick={backToSetup}
        />
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-music" }} text="lyric line" />
        <p class="text-sub">
          karaoke typing over your own song — bring an audio file and the
          lyrics, sing with your fingers.
        </p>
      </section>
      <Show when={pagePhase() !== "setup"} fallback={<Menu />}>
        <Show
          when={pagePhase() !== "summary" && pagePhase() !== "voided"}
          fallback={
            <Show when={pagePhase() === "summary"} fallback={<VoidedScreen />}>
              <SummaryScreen />
            </Show>
          }
        >
          <Player />
        </Show>
      </Show>
    </div>
  );
}
