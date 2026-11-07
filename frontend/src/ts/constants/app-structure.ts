/**
 * The app's top-level structure: the home hub's sections and their
 * sub-sections (the desktop fork's start screen).
 *
 * Single source of truth: the home page and the generic section picker
 * (`/sections/$sectionId`) render whatever is declared here, so adding a
 * section or sub-section is a data change — no router or page rewrites.
 * Every referenced route must exist in the route tree (spec-guarded), and
 * destinations must be real pages: declare nothing that is not built yet.
 */

export type AppSubSection = {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** an existing route path this sub-section opens */
  route: string;
};

export type AppSection = {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** sections with a single destination link straight to it (no picker) */
  route?: string;
  subSections?: readonly AppSubSection[];
};

export const APP_SECTIONS: readonly AppSection[] = [
  {
    id: "learning",
    title: "learning",
    description: "progressive course and adaptive lessons",
    icon: "fa-graduation-cap",
    subSections: [
      {
        id: "learn",
        title: "progressive learning",
        description: "unlock letter groups step by step at your own pace",
        icon: "fa-chalkboard",
        route: "/learn",
      },
      {
        id: "keybr",
        title: "keybr engine",
        description: "lessons that follow your weakest keys automatically",
        icon: "fa-bolt",
        route: "/keybr",
      },
    ],
  },
  {
    id: "practice",
    title: "practice",
    description: "the classic test and targeted drills",
    icon: "fa-keyboard",
    subSections: [
      {
        id: "test",
        title: "typing test",
        description: "time, words, quotes and zen — the classic test",
        icon: "fa-keyboard",
        route: "/",
      },
      {
        id: "drills",
        title: "drills",
        description: "rows, hands and your weak letters, on repeat",
        icon: "fa-dumbbell",
        route: "/drills",
      },
    ],
  },
  {
    id: "games",
    title: "games",
    description:
      "typing, but playful — word blast, duels, ghosts & a roguelite",
    icon: "fa-gamepad",
    subSections: [
      {
        id: "word-blast",
        title: "word blast",
        description: "falling words, three lives, high scores",
        icon: "fa-bomb",
        route: "/games/word-blast",
      },
      {
        id: "bot-duel",
        title: "bot duel",
        description: "race a bot with a fixed wpm over one word stream",
        icon: "fa-robot",
        route: "/games/bot-duel",
      },
      {
        id: "ghost-gp",
        title: "ghost gp",
        description: "race your own ghosts — last run or personal best",
        icon: "fa-ghost",
        route: "/games/ghost-gp",
      },
      {
        id: "sprint",
        title: "ten-second sprint",
        description: "maximum wpm in a ten-second burst — wait for GO",
        icon: "fa-bolt",
        route: "/games/sprint",
      },
      {
        id: "wordle",
        title: "wordle",
        description: "one daily 5-letter puzzle — فارسی و english",
        icon: "fa-font",
        route: "/games/wordle",
      },
      {
        id: "balloon-pop",
        title: "balloon pop",
        description: "pop rising balloons — your weak letters first",
        icon: "fa-circle",
        route: "/games/balloon-pop",
      },
      {
        id: "deck-runner",
        title: "deck runner",
        description: "a typing roguelite — quotas, gold, jokers",
        icon: "fa-layer-group",
        route: "/games/deck-runner",
      },
    ],
  },
];

export function getSection(id: string | undefined): AppSection | undefined {
  return APP_SECTIONS.find((section) => section.id === id);
}

/** a section with several sub-sections opens the picker page first */
export function sectionHasPicker(section: AppSection): boolean {
  return (section.subSections?.length ?? 0) > 1;
}

/** where a section card links to: the picker, its direct destination, or its
 * single sub-section */
export function sectionDestination(section: AppSection): string {
  if (sectionHasPicker(section)) return `/sections/${section.id}`;
  if (section.route !== undefined) return section.route;
  return section.subSections?.[0]?.route ?? `/sections/${section.id}`;
}
