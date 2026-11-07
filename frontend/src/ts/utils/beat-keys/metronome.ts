import { BALANCE } from "./balance";

/**
 * Beat Keys metronome (idea G21, phase 1): a pure WebAudio oscillator
 * click — zero bundled audio assets (doc §۰). Scheduling follows the
 * official WebAudio «lookahead» pattern (doc §۲): a 25ms scheduler pass
 * registers clicks 100ms ahead on the audio clock, so the beat never
 * stutters even when the main thread hiccups.
 */

/** the WebAudio subset the metronome touches (mockable for tests) */
export type MetronomeOscillator = {
  type: string;
  frequency: { setValueAtTime(value: number, when?: number): void };
  connect(destination: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
};

export type MetronomeGain = {
  gain: {
    setValueAtTime(value: number, when?: number): void;
    exponentialRampToValueAtTime(value: number, when?: number): void;
  };
  connect(destination: unknown): void;
};

export type MetronomeAudioCtx = {
  currentTime: number;
  destination: unknown;
  createOscillator(): MetronomeOscillator;
  createGain(): MetronomeGain;
};

export type Metronome = {
  start(): void;
  stop(): void;
  /** one scheduler pass — public so tests can drive a mock clock */
  schedulePass(): void;
  /** the audio-clock second of the next scheduled click */
  nextClickSec(): number;
  clickCount(): number;
};

export function createMetronome(options: {
  audioCtx: MetronomeAudioCtx;
  bpm: number;
  volume?: number;
  schedulerIntervalMs?: number;
  lookaheadMs?: number;
}): Metronome {
  const schedulerIntervalMs =
    options.schedulerIntervalMs ?? BALANCE.schedulerIntervalMs;
  const lookaheadMs = options.lookaheadMs ?? BALANCE.lookaheadMs;
  const beatSec = 60 / options.bpm;
  let nextClickSec = options.audioCtx.currentTime + lookaheadMs / 1000;
  let clicks = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function scheduleClick(atSec: number): void {
    const ctx = options.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1000, atSec);
    gain.gain.setValueAtTime(options.volume ?? 0.2, atSec);
    gain.gain.exponentialRampToValueAtTime(0.0001, atSec + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(atSec);
    osc.stop(atSec + 0.06);
    clicks += 1;
  }

  function schedulePass(): void {
    while (nextClickSec < options.audioCtx.currentTime + lookaheadMs / 1000) {
      scheduleClick(nextClickSec);
      nextClickSec += beatSec;
    }
  }

  return {
    start() {
      schedulePass();
      timer = setInterval(schedulePass, schedulerIntervalMs);
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    schedulePass,
    nextClickSec: () => nextClickSec,
    clickCount: () => clicks,
  };
}
