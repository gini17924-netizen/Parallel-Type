import Ape from "./ape";
import { showErrorNotification } from "./states/notifications";
import { isAuthenticated } from "./states/core";
import * as Dates from "date-fns";
import {
  TestActivityCalendar,
  ModifiableTestActivityCalendar,
} from "./elements/test-activity-calendar";
import { showLoaderBar, hideLoaderBar } from "./states/loader-bar";
import { Badge } from "@monkeytype/schemas/users";
import { Difficulty } from "@monkeytype/schemas/configs";
import {
  Mode,
  Mode2,
  PersonalBest,
  PersonalBests,
} from "@monkeytype/schemas/shared";
import {
  getDefaultSnapshot,
  Snapshot,
  SnapshotResult,
} from "./constants/default-snapshot";
import { getFirstDayOfTheWeek } from "./utils/date-and-time";
import { Language } from "@monkeytype/schemas/languages";
import { authEvent } from "./events/auth";
import { configurationPromise } from "./ape/server-configuration";
import {
  deleteLocalResultFromCollection,
  insertLocalResult,
  resultsCollection,
} from "./collections/results";
import {
  getLastResult,
  setLastResult,
  _setSnapshot as setSolidSnapshot,
} from "./states/snapshot";
import { XpBreakdown } from "@monkeytype/schemas/results";
import { setXpBarData } from "./states/header";
import { FunboxMetadata } from "@monkeytype/funbox";
import { __nonReactive } from "./collections/tags";
import { fetchUserFromApi } from "./ape/user";
import { SnapshotInitError } from "./utils/snapshot-init-error";
import { effectiveCustomPunctuation } from "./test/custom-punctuation";
import { updateTagsInFilterStorage } from "./states/result-filters";
import * as DesktopAutoBackup from "./utils/desktop-auto-backup";
import { applyDeleteSnapshotSideEffects } from "./utils/local-result-maintenance";
import {
  DESKTOP_OFFLINE,
  deleteLocalResult as removeLocalResultFromStorage,
  importBackup,
  loadLocalResults,
  loadLocalSnapshotFields,
  saveLocalSnapshotFields,
  type LocalBackup,
} from "./utils/local-persistence";
import { updateLocalStreak } from "./utils/local-streak";
import { computeLocalXp } from "./utils/local-xp";

let dbSnapshot: Snapshot | undefined;
const firstDayOfTheWeek = getFirstDayOfTheWeek();

export function getSnapshot(): Snapshot | undefined {
  return dbSnapshot;
}

export function setSnapshot(
  newSnapshot: Snapshot | undefined,
  options?: { dispatchEvent?: boolean },
): void {
  const originalBanned = dbSnapshot?.banned;
  const originalVerified = dbSnapshot?.verified;
  const lbOptOut = dbSnapshot?.lbOptOut;

  //not allowing user to override these values i guess?
  try {
    delete newSnapshot?.banned;
  } catch {}
  try {
    delete newSnapshot?.verified;
  } catch {}
  try {
    delete newSnapshot?.lbOptOut;
  } catch {}
  dbSnapshot = newSnapshot;
  if (dbSnapshot) {
    dbSnapshot.banned = originalBanned;
    dbSnapshot.verified = originalVerified;
    dbSnapshot.lbOptOut = lbOptOut;
  }

  if (options?.dispatchEvent !== false) {
    authEvent.dispatch({ type: "snapshotUpdated", data: { isInitial: false } });
  }

  setSolidSnapshot(newSnapshot);
}

export async function initSnapshot(): Promise<Snapshot | false> {
  //send api request with token that returns tags, presets, and data needed for snap
  const snap = getDefaultSnapshot();
  await configurationPromise;

  try {
    if (!isAuthenticated()) return false;

    const [userData] = await Promise.all([fetchUserFromApi()]);

    if (userData === null || userData === undefined) {
      throw new SnapshotInitError(
        `Request was successful but user data is null/undefined`,
        200,
      );
    }

    snap.name = userData.name;
    snap.personalBests = userData.personalBests;
    snap.personalBests ??= {
      time: {},
      words: {},
      quote: {},
      zen: {},
      custom: {},
    };

    for (const mode of ["time", "words", "quote", "zen", "custom"]) {
      snap.personalBests[mode as keyof PersonalBests] ??= {};
    }

    snap.banned = userData.banned;
    snap.lbOptOut = userData.lbOptOut;
    snap.verified = userData.verified;
    snap.discordId = userData.discordId;
    snap.discordAvatar = userData.discordAvatar;
    snap.needsToChangeName = userData.needsToChangeName;
    snap.typingStats = {
      timeTyping: userData.timeTyping ?? 0,
      startedTests: userData.startedTests ?? 0,
      completedTests: userData.completedTests ?? 0,
    };
    snap.quoteMod = userData.quoteMod;
    snap.favoriteQuotes = userData.favoriteQuotes ?? {};
    snap.quoteRatings = userData.quoteRatings;
    snap.details = userData.profileDetails;
    snap.addedAt = userData.addedAt;
    snap.inventory = userData.inventory;
    snap.xp = userData.xp ?? 0;
    snap.inboxUnreadSize = userData.inboxUnreadSize ?? 0;
    snap.streak = userData?.streak?.length ?? 0;
    snap.maxStreak = userData?.streak?.maxLength ?? 0;
    snap.isPremium = userData?.isPremium ?? false;
    snap.allTimeLbs = userData.allTimeLbs;

    if (userData.testActivity !== undefined) {
      snap.testActivity = new ModifiableTestActivityCalendar(
        userData.testActivity.testsByDays,
        new Date(userData.testActivity.lastDay),
        firstDayOfTheWeek,
      );
    }

    const hourOffset = userData?.streak?.hourOffset;
    snap.streakHourOffset = hourOffset ?? undefined;

    if (userData.lbMemory !== undefined) {
      snap.lbMemory = userData.lbMemory;
    }

    updateTagsInFilterStorage(userData.tags?.map((it) => it._id) ?? []);

    dbSnapshot = snap;

    return dbSnapshot;
  } catch (e) {
    dbSnapshot = getDefaultSnapshot();
    throw e;
  } finally {
    setSolidSnapshot(dbSnapshot);
  }
}
export function getLocalPB<M extends Mode>(
  mode: M,
  mode2: Mode2<M>,
  punctuation: boolean,
  numbers: boolean,
  language: string,
  difficulty: Difficulty,
  lazyMode: boolean,
  funboxes: FunboxMetadata[],
): PersonalBest | undefined {
  if (!funboxes.every((f) => f.canGetPb)) {
    return undefined;
  }

  const pbs = dbSnapshot?.personalBests?.[mode]?.[mode2] as
    | PersonalBest[]
    | undefined;

  return pbs?.find(
    (pb) =>
      (pb.punctuation ?? false) === punctuation &&
      (pb.numbers ?? false) === numbers &&
      pb.difficulty === difficulty &&
      pb.language === language &&
      (pb.lazyMode ?? false) === lazyMode &&
      //PB entries are per punctuation set, keyed by the EFFECTIVE set
      //(audit Y5b): with the default style the generator uses the built-in
      //per-language tables, so those PBs share the "" identity - a raw
      //non-empty Config.customPunctuation string must not leak in here
      (pb.customPunctuation ?? "") === effectiveCustomPunctuation(),
  );
}

function saveLocalPB<M extends Mode>(
  mode: M,
  mode2: Mode2<M>,
  punctuation: boolean,
  numbers: boolean,
  language: Language,
  difficulty: Difficulty,
  lazyMode: boolean,
  wpm: number,
  acc: number,
  raw: number,
  consistency: number,
): void {
  //quote mode saves too (phase 66): mode2 is the quote id and the
  //language is part of the key, so persian sessions never touch the
  //english buckets — the old exclusion mirrored the server, which owned
  //quote pbs; the offline build owns them locally
  if (!dbSnapshot) return;
  function cont(): void {
    if (!dbSnapshot) return;
    let found = false;

    dbSnapshot.personalBests ??= {
      time: {},
      words: {},
      quote: {},
      zen: {},
      custom: {},
    };

    dbSnapshot.personalBests[mode] ??= {
      [mode2]: [],
    };

    dbSnapshot.personalBests[mode][mode2] ??=
      [] as unknown as PersonalBests[M][Mode2<M>];

    (
      dbSnapshot.personalBests[mode][mode2] as unknown as PersonalBest[]
    ).forEach((pb) => {
      if (
        (pb.punctuation ?? false) === punctuation &&
        (pb.numbers ?? false) === numbers &&
        pb.difficulty === difficulty &&
        pb.language === language &&
        (pb.lazyMode ?? false) === lazyMode &&
        //per punctuation set (idea #4, effective identity per audit Y5b):
        //a save under a different set must create its own entry, never
        //overwrite another set's PB
        (pb.customPunctuation ?? "") === effectiveCustomPunctuation()
      ) {
        found = true;
        pb.wpm = wpm;
        pb.acc = acc;
        pb.raw = raw;
        pb.timestamp = Date.now();
        pb.consistency = consistency;
        pb.lazyMode = lazyMode;
        pb.customPunctuation = effectiveCustomPunctuation();
      }
    });
    if (!found) {
      //nothing found
      (dbSnapshot.personalBests[mode][mode2] as unknown as PersonalBest[]).push(
        {
          language,
          difficulty,
          lazyMode,
          punctuation,
          numbers,
          wpm,
          acc,
          raw,
          timestamp: Date.now(),
          consistency,
          customPunctuation: effectiveCustomPunctuation(),
        },
      );
    }
  }

  if (dbSnapshot !== null) {
    cont();
  }
}

export async function updateLbMemory<M extends Mode>(
  mode: M,
  mode2: Mode2<M> | undefined,
  language: Language,
  rank: number,
  api = false,
): Promise<void> {
  if (mode2 === undefined) return;
  if (mode === "time") {
    const timeMode = mode;
    const timeMode2 = mode2 as "15" | "60";

    const snapshot = getSnapshot();
    if (!snapshot) return;
    snapshot.lbMemory ??= {
      time: { "15": { english: 0 }, "60": { english: 0 } },
    };
    snapshot.lbMemory[timeMode] ??= {
      "15": { english: 0 },
      "60": { english: 0 },
    };
    snapshot.lbMemory[timeMode][timeMode2] ??= {};
    const current = snapshot.lbMemory?.[timeMode]?.[timeMode2]?.[language];

    //this is protected above so not sure why it would be undefined
    const mem = snapshot.lbMemory[timeMode][timeMode2];
    mem[language] = rank;
    if (api && current !== rank) {
      await Ape.users.updateLeaderboardMemory({
        body: { mode, mode2, language, rank },
      });
    }
    setSnapshot(snapshot);
  }
}

/** the boot/reload snapshot for signed-out desktop users: defaults overlaid
 * with whatever is persisted in localStorage */
function buildLocalSnapshot(): Snapshot {
  const snap = getDefaultSnapshot();
  const stored = loadLocalSnapshotFields();
  if (stored !== undefined) {
    snap.personalBests = stored.personalBests ?? snap.personalBests;
    snap.typingStats = stored.typingStats;
    snap.xp = stored.xp;
    snap.streak = stored.streak;
    snap.maxStreak = stored.maxStreak;
    snap.streakLastResultTimestamp = stored.streakLastResultTimestamp;
  }
  return snap;
}

/**
 * desktop offline build: give signed-out users a snapshot so local results,
 * personal bests and typing stats work, restored from localStorage.
 */
export function initLocalSnapshot(): void {
  if (dbSnapshot !== undefined) return;
  if (isAuthenticated()) return;
  setSnapshot(buildLocalSnapshot(), { dispatchEvent: false });
}

/**
 * desktop offline build: rebuild the in-memory session state from storage
 * (audit Y1). A backup import writes storage directly - without this, the
 * session keeps its pre-import (possibly empty) snapshot and the first
 * saveLocalResult persists it over the restored data. Mirrors the boot path
 * (initLocalSnapshot) and the collection's boot fill (results.ts queryFn).
 */
export async function reloadLocalSnapshotIntoSession(): Promise<void> {
  if (isAuthenticated()) return;
  setSnapshot(buildLocalSnapshot(), { dispatchEvent: false });
  try {
    const results = await loadLocalResults();
    if (getLastResult() === undefined && results.length > 0) {
      //loadLocalResults is oldest first: the newest is the last one
      setLastResult(results.at(-1));
    }
  } catch {
    //a storage read failure must not fail the import itself
  }
}

/**
 * desktop offline build: one import path for both the automatic restore at
 * boot (desktop-auto-backup) and the manual restore on the account page -
 * applies the backup to storage, then resyncs the in-memory session state
 * (audit Y1).
 */
export async function importLocalBackup(backup: LocalBackup): Promise<number> {
  const imported = await importBackup(backup);
  if (!isAuthenticated() && DESKTOP_OFFLINE) {
    await reloadLocalSnapshotIntoSession();
    if (resultsCollection.isReady()) {
      //the collection caches with staleTime Infinity: an outside write is
      //never seen without an explicit refetch
      void resultsCollection.utils.refetch();
    }
  }
  return imported;
}

//the auto-backup module statically imports this file: it gets the importer
//handed over instead of importing back (module cycle, see registerBackupImporter)
DesktopAutoBackup.registerBackupImporter(importLocalBackup);

export type SaveLocalResultData = {
  xp?: number;
  xpBreakdown?: XpBreakdown;
  streak?: number;
  result?: SnapshotResult<Mode>;
  isPb?: boolean;
};

export function saveLocalResult(data: SaveLocalResultData): void {
  const snapshot = getSnapshot();
  if (!snapshot) return;

  let xp = data.xp;

  if (data.result !== undefined) {
    if (DESKTOP_OFFLINE) {
      //record the effective punctuation identity on the persisted row
      //(audit Y5): PB buckets and the delete-path matching key off it
      data.result.customPunctuation = effectiveCustomPunctuation();
    }
    //desktop offline build: mirror the backend order (dal/user.ts
    //updateStreak → result.ts calculateXp) — the streak updates first, then
    //XP is computed with the POST-update streak. Signed-in and modal paths
    //pass server values and keep upstream behavior.
    if (DESKTOP_OFFLINE && data.streak === undefined && xp === undefined) {
      const streakUpdate = updateLocalStreak(
        {
          lastResultTimestamp: snapshot.streakLastResultTimestamp ?? 0,
          length: snapshot.streak,
          maxLength: snapshot.maxStreak,
        },
        data.result.timestamp,
      );
      snapshot.streak = streakUpdate.length;
      snapshot.maxStreak = streakUpdate.maxLength;
      snapshot.streakLastResultTimestamp = streakUpdate.lastResultTimestamp;
      xp = computeLocalXp(data.result, streakUpdate.length);
    }

    void insertLocalResult({ result: data.result });
    setLastResult(data.result);
    if (snapshot.testActivity !== undefined) {
      snapshot.testActivity.increment(new Date(data.result.timestamp));
    }
    snapshot.typingStats ??= {
      timeTyping: 0,
      startedTests: 0,
      completedTests: 0,
    };

    const time =
      data.result.testDuration +
      data.result.incompleteTestSeconds -
      data.result.afkDuration;

    snapshot.typingStats.timeTyping += time;
    snapshot.typingStats.startedTests += data.result.restartCount + 1;
    snapshot.typingStats.completedTests += 1;

    if (data.isPb) {
      saveLocalPB(
        data.result.mode,
        data.result.mode2,
        data.result.punctuation,
        data.result.numbers,
        data.result.language,
        data.result.difficulty,
        data.result.lazyMode,
        data.result.wpm,
        data.result.acc,
        data.result.rawWpm,
        data.result.consistency,
      );
    }
  }

  if (xp !== undefined) {
    snapshot.xp ??= 0;
    snapshot.xp += xp;
  }

  if (data.streak !== undefined) {
    snapshot.streak = data.streak;

    if (snapshot.streak > snapshot.maxStreak) {
      snapshot.maxStreak = snapshot.streak;
    }
    //keep local streak bookkeeping consistent with a server-provided streak
    //(signed-in / last-signed-out-result paths)
    if (data.result !== undefined) {
      snapshot.streakLastResultTimestamp = data.result.timestamp;
    }
  }

  setSnapshot(snapshot, {
    dispatchEvent: false,
  });
  if (!isAuthenticated() && DESKTOP_OFFLINE) {
    //desktop offline build: persist snapshot so pbs/stats survive restarts
    saveLocalSnapshotFields(snapshot);
  }
  if (xp !== undefined) {
    setXpBarData({
      addedXp: xp,
      resultingXp: snapshot.xp,
      breakdown: data.xpBreakdown,
    });
  }
}

/**
 * Deletes one local result (desktop offline build, idea #2): persists the
 * deletion, recomputes the dependent snapshot state (typingStats reversal,
 * streak, PB bucket + isPb promotion), updates the live collection and
 * queues the automatic backup. XP is intentionally retained unchanged.
 */
export async function deleteLocalResult(resultId: string): Promise<void> {
  if (!isAuthenticated() && DESKTOP_OFFLINE) {
    //identify the target from storage truth before the deletion
    const all = await loadLocalResults();
    const target = all.find((it) => it._id === resultId);
    await removeLocalResultFromStorage(resultId);
    const remaining = await loadLocalResults();

    const snapshot = getSnapshot();
    if (target !== undefined && snapshot !== undefined) {
      const { promotedId } = applyDeleteSnapshotSideEffects(
        snapshot,
        target,
        remaining,
      );
      setSnapshot(snapshot, { dispatchEvent: false });
      saveLocalSnapshotFields(snapshot);
      if (promotedId !== undefined && resultsCollection.isReady()) {
        //keep the account PB filter truthful: the promoted row becomes PB
        resultsCollection.utils.writeUpdate({ _id: promotedId, isPb: true });
      }
    }

    //the deleted result was the newest: move the last-result pointer back
    if (target !== undefined && all.at(-1)?._id === resultId) {
      setLastResult(remaining.at(-1));
    }

    DesktopAutoBackup.queueAutoBackup();
  }
  await deleteLocalResultFromCollection({ resultId });
}

export function addXp(xp: number, breakdown?: XpBreakdown): void {
  const snapshot = getSnapshot();
  if (!snapshot) return;

  snapshot.xp ??= 0;
  snapshot.xp += xp;
  setSnapshot(snapshot, {
    dispatchEvent: false,
  });
  setXpBarData({
    addedXp: xp,
    resultingXp: snapshot.xp,
    breakdown: breakdown,
  });
}

export function updateInboxUnreadSize(newSize: number): void {
  const snapshot = getSnapshot();
  if (!snapshot) return;

  snapshot.inboxUnreadSize = newSize;
  setSnapshot(snapshot);
}

export function addBadge(badge: Badge): void {
  const snapshot = getSnapshot();
  if (!snapshot) return;

  snapshot.inventory ??= {
    badges: [],
  };
  snapshot.inventory.badges.push(badge);
  setSnapshot(snapshot);
}

export async function getTestActivityCalendar(
  yearString: string,
): Promise<TestActivityCalendar | undefined> {
  if (!isAuthenticated() || dbSnapshot === undefined) return undefined;

  if (yearString === "current") return dbSnapshot.testActivity;

  const currentYear = new Date().getFullYear().toString();
  if (yearString === currentYear) {
    return dbSnapshot.testActivity?.getFullYearCalendar();
  }

  if (dbSnapshot.testActivityByYear === undefined) {
    showLoaderBar();
    const response = await Ape.users.getTestActivity();
    if (response.status !== 200) {
      showErrorNotification("Error getting test activities", { response });
      hideLoaderBar();
      return undefined;
    }

    dbSnapshot.testActivityByYear = {};
    for (const year in response.body.data) {
      if (year === currentYear) continue;
      const testsByDays = response.body.data[year] ?? [];
      const lastDay = Dates.addDays(
        new Date(parseInt(year), 0, 1),
        testsByDays.length,
      );

      dbSnapshot.testActivityByYear[year] = new TestActivityCalendar(
        testsByDays,
        lastDay,
        firstDayOfTheWeek,
        true,
      );
    }
    hideLoaderBar();
  }

  return dbSnapshot.testActivityByYear[yearString];
}
