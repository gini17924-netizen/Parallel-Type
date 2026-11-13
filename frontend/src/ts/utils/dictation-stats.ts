/*
 * The dictation store (phase 68): every tts-funbox session (the words
 * are hidden and spoken — real dictation) records its spelling-accuracy
 * score here. An independent store per the fork rule: dictation stats
 * never mix into the main typing stats, and the all-time average gives
 * the result page its "spelling accuracy" context line.
 */
import { z } from "zod";

const sessionSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  language: z.string(),
  mode: z.string(),
  spellingAccuracy: z.number().min(0).max(100),
  wpm: z.number().min(0),
});

const stateSchema = z.object({
  sessions: z.array(sessionSchema).max(200),
});

export type DictationSession = z.infer<typeof sessionSchema>;
export type DictationState = z.infer<typeof stateSchema>;

const STORAGE_KEY = "mtDesktopDictation";
/** the store keeps the most recent 100 sessions */
const SESSION_CAP = 100;

export function getDictationState(): DictationState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { sessions: [] };
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    //one corrupt row must not throw away the whole history — keep the
    //individually valid sessions (the truncate-write lesson, applied)
    const rawSessions = (JSON.parse(raw) as { sessions?: unknown }).sessions;
    if (!Array.isArray(rawSessions)) return { sessions: [] };
    const sessions = rawSessions.flatMap((row) => {
      const parsedRow = sessionSchema.safeParse(row);
      return parsedRow.success ? [parsedRow.data] : [];
    });
    return { sessions };
  } catch {
    return { sessions: [] };
  }
}

export function recordDictationSession(
  session: DictationSession,
): DictationState {
  const state = getDictationState();
  state.sessions.push(session);
  if (state.sessions.length > SESSION_CAP) {
    state.sessions.splice(0, state.sessions.length - SESSION_CAP);
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

/** the mean spelling accuracy across recorded sessions; undefined when
 * nothing has been recorded yet */
export function dictationSpellingAccuracy(): number | undefined {
  const { sessions } = getDictationState();
  if (sessions.length === 0) return undefined;
  const sum = sessions.reduce(
    (acc, session) => acc + session.spellingAccuracy,
    0,
  );
  return Math.round((sum / sessions.length) * 100) / 100;
}
