import { createSignal } from "solid-js";
import { z } from "zod";

import { APP_SECTIONS, type AppSection } from "../../constants/app-structure";
import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * phase 96: the home page's personal layout — the order and visibility of
 * the section cards, persisted in the independent-store house rule
 * (mtDesktopHomeLayout). reordering is button-driven (up/down), not drag
 * and drop. an EMPTY order in the store means the registry default, so a
 * fresh install renders exactly APP_SECTIONS until the user touches it.
 * reset exists for the specs only.
 */

const HomeLayoutSchema = z.object({
  order: z.array(z.string()),
  hidden: z.array(z.string()),
});

type HomeLayout = z.infer<typeof HomeLayoutSchema>;

const layoutStore = new LocalStorageWithSchema({
  key: "mtDesktopHomeLayout",
  schema: HomeLayoutSchema,
  fallback: { order: [], hidden: [] },
});

const [layoutState, setLayoutState] = createSignal<HomeLayout>(
  layoutStore.get(),
);

function persist(next: HomeLayout): void {
  layoutStore.set(next);
  setLayoutState(next);
}

/** the effective order: the stored order first, then any registry sections
 * the user has not placed yet (future sections appear at the end) */
function effectiveOrder(): string[] {
  const stored = layoutState().order;
  const known = APP_SECTIONS.map((s) => s.id);
  const placed = stored.filter((id) => known.includes(id));
  const rest = known.filter((id) => !placed.includes(id));
  return [...placed, ...rest];
}

/** the home page's cards: registry sections in the personal order, split
 * into the visible ones and the hidden ones */
export function homeCards(): {
  visible: AppSection[];
  hidden: AppSection[];
} {
  const hiddenIds = new Set(layoutState().hidden);
  const visible: AppSection[] = [];
  const hidden: AppSection[] = [];
  for (const id of effectiveOrder()) {
    const section = APP_SECTIONS.find((s) => s.id === id);
    if (section === undefined) continue;
    (hiddenIds.has(id) ? hidden : visible).push(section);
  }
  return { visible, hidden };
}

function move(id: string, delta: -1 | 1): void {
  const order = effectiveOrder();
  const index = order.indexOf(id);
  if (index === -1) return;
  const target = index + delta;
  if (target < 0 || target >= order.length) return;
  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, id);
  persist({ ...layoutState(), order: next });
}

export function moveSectionUp(id: string): void {
  move(id, -1);
}

export function moveSectionDown(id: string): void {
  move(id, 1);
}

export function toggleSectionHidden(id: string): void {
  const hidden = layoutState().hidden;
  const next = hidden.includes(id)
    ? hidden.filter((h) => h !== id)
    : [...hidden, id];
  persist({ ...layoutState(), hidden: next });
}

/** wipes the personal layout (the specs' reset; prod never calls it) */
export function resetHomeLayout(): void {
  layoutStore.clear();
  setLayoutState(layoutStore.get());
}
