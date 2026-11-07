import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Lyric Line session history for the desktop offline build (idea G20,
 * phase 1). ONLY the metadata persists — the audio file and the lyric
 * text never do (doc §۱: «فایل صوتی هرگز ذخیره نمی‌شود»). Backup owner:
 * utils/local-persistence.ts (`lyricSessions` field, optional — wired
 * in the page phase).
 */

export const LYRIC_SESSIONS_KEY = "mtDesktopLyricSessions";

const SessionSchema = z.object({
  at: z.number(),
  songName: z.string().max(120),
  lines: z.number(),
  acc: z.number(),
  syncScore: z.number().optional(),
});

const SessionsSchema = z.object({
  sessions: z.array(SessionSchema).max(10),
});

export type LyricSessionRecord = z.infer<typeof SessionSchema>;
type LyricSessions = z.infer<typeof SessionsSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<LyricSessions>({
  key: LYRIC_SESSIONS_KEY,
  schema: SessionsSchema,
  fallback: { sessions: [] },
});

/** records a finished session (metadata only — never the media) */
export function recordLyricSession(input: {
  songName: string;
  lines: number;
  acc: number;
  syncScore: number | undefined;
}): void {
  const current = store.get();
  store.set({
    sessions: [
      {
        at: Date.now(),
        songName: input.songName.slice(0, 120),
        lines: input.lines,
        acc: input.acc,
        syncScore: input.syncScore,
      },
      ...current.sessions,
    ].slice(0, HISTORY_LIMIT),
  });
}

export function getLyricSessions(limit = HISTORY_LIMIT): LyricSessionRecord[] {
  return store.get().sessions.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetLyricSessionsForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedLyricSessions = {
  sessions: LyricSessionRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedLyricSessions(
  value: unknown,
): SanitizedLyricSessions {
  const sanitized: SanitizedLyricSessions = { sessions: [] };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as { sessions?: unknown };
  const rawSessions = raw.sessions;
  if (Array.isArray(rawSessions)) {
    sanitized.sessions = rawSessions
      .map((it) => SessionSchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  return sanitized;
}
