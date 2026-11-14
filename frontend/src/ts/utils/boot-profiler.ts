/**
 * phase 100: the boot profiler — records the startup milestones (module
 * load → app ready → page rendered) with relative ms so the BOOT BUDGET
 * (< 2s to app ready, council doc §H) is measurable on any machine: the
 * report lands in the console and the mtDesktopBootReport store, readable
 * from the SignalsDevtools or the console on every shipped build. PURE
 * bookkeeping: milestones are stamped, nothing is measured after the fact.
 */

import { createSignal } from "solid-js";
import { z } from "zod";

import { LocalStorageWithSchema } from "./local-storage-with-schema";

const BootReportSchema = z.object({
  startedAt: z.number(),
  milestones: z.record(z.string(), z.number()),
});

export type BootReport = z.infer<typeof BootReportSchema>;

const reportStore = new LocalStorageWithSchema({
  key: "mtDesktopBootReport",
  schema: BootReportSchema,
  fallback: { startedAt: Date.now(), milestones: {} },
});

const BOOT_BUDGET_MS = 2000;

const [report, setReport] = createSignal<BootReport>(reportStore.get());

const MODULE_LOAD_AT = Date.now();

/** stamps one milestone with its delta from the module load */
export function stampBootMilestone(name: string): void {
  const at = Date.now();
  const current = report();
  const next: BootReport = {
    startedAt: MODULE_LOAD_AT,
    milestones: { ...current.milestones, [name]: at - MODULE_LOAD_AT },
  };
  reportStore.set(next);
  setReport(next);
}

/** the stored report (the console/devtools reader) */
export function getBootReport(): BootReport {
  return report();
}

/** the budget verdict: the app-ready milestone against the 2s budget */
export function bootWithinBudget(): boolean {
  const ready = report().milestones["app-ready"];
  return ready === undefined || ready <= BOOT_BUDGET_MS;
}

/** the one-line console report */
export function bootReportLine(): string {
  const current = report();
  const parts = Object.entries(current.milestones).map(
    ([name, ms]) => `${name}=${ms}ms`,
  );
  const ready = current.milestones["app-ready"];
  const verdict =
    ready === undefined
      ? "pending"
      : ready <= BOOT_BUDGET_MS
        ? "within"
        : "over";
  return `boot report (${verdict} budget ${BOOT_BUDGET_MS}ms): ${
    parts.join(", ") || "no milestones"
  }`;
}

/** prints the report once (the App module-load call) */
export function logBootReport(): void {
  console.info(bootReportLine());
}

/** the specs' reset */
export function resetBootProfiler(): void {
  reportStore.clear();
  setReport(reportStore.get());
}
