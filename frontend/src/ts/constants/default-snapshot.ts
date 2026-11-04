import { User, UserProfileDetails } from "@monkeytype/schemas/users";
import { getDefaultConfig } from "./default-config";
import { Mode } from "@monkeytype/schemas/shared";
import { Result } from "@monkeytype/schemas/results";
import { Difficulty, FunboxName } from "@monkeytype/schemas/configs";
import {
  ModifiableTestActivityCalendar,
  TestActivityCalendar,
} from "../elements/test-activity-calendar";
import { Language } from "@monkeytype/schemas/languages";

export type SnapshotResult<M extends Mode> = Omit<
  Result<M>,
  | "bailedOut"
  | "blindMode"
  | "lazyMode"
  | "difficulty"
  | "funbox"
  | "language"
  | "numbers"
  | "punctuation"
  | "quoteLength"
  | "restartCount"
  | "incompleteTestSeconds"
  | "afkDuration"
  | "tags"
> & {
  bailedOut: boolean;
  blindMode: boolean;
  lazyMode: boolean;
  difficulty: Difficulty;
  funbox: FunboxName[];
  language: Language;
  numbers: boolean;
  punctuation: boolean;
  quoteLength: number;
  restartCount: number;
  incompleteTestSeconds: number;
  afkDuration: number;
  tags: string[];
  //calculated values
  words: number;
  timeTyping: number;
  dayTimestamp: number;
  //desktop fork (audit Y5): the effective punctuation set at save time,
  //recorded by the offline save path; legacy rows lack the field
  customPunctuation?: string;
};

export type Snapshot = Omit<
  User,
  | "timeTyping"
  | "startedTests"
  | "completedTests"
  | "profileDetails"
  | "streak"
  | "resultFilterPresets"
  | "tags"
  | "customThemes"
  | "xp"
  | "testActivity"
> & {
  typingStats: {
    timeTyping: number;
    startedTests: number;
    completedTests: number;
  };
  details?: UserProfileDetails;
  inboxUnreadSize: number;
  streak: number;
  maxStreak: number;
  //desktop offline build: streak bookkeeping — the backend stores this inside
  //the user's streak object; locally it lives flat on the snapshot
  streakLastResultTimestamp?: number;
  isPremium: boolean;
  streakHourOffset?: number;
  xp: number;
  testActivity?: ModifiableTestActivityCalendar;
  testActivityByYear?: { [key: string]: TestActivityCalendar };
  isMiniSnapshot?: never;
};

const defaultSnap = {
  personalBests: {
    time: {},
    words: {},
    quote: {},
    zen: {},
    custom: {},
  },
  name: "",
  email: "",
  uid: "",
  isPremium: false,
  config: getDefaultConfig(),
  banned: undefined,
  verified: undefined,
  lbMemory: { time: { 15: { english: 0 }, 60: { english: 0 } } },
  typingStats: {
    timeTyping: 0,
    startedTests: 0,
    completedTests: 0,
  },
  quoteRatings: undefined,
  quoteMod: false,
  favoriteQuotes: {},
  addedAt: 0,
  xp: 0,
  inboxUnreadSize: 0,
  streak: 0,
  maxStreak: 0,
  streakHourOffset: undefined,
  streakLastResultTimestamp: 0,
  //desktop offline build: a fresh local profile has no leaderboard data;
  //fake entries rendered "0th / Top NaN%" on the account page
  allTimeLbs: {
    time: {},
  },
} as Snapshot;

export function getDefaultSnapshot(): Snapshot {
  return structuredClone(defaultSnap);
}
