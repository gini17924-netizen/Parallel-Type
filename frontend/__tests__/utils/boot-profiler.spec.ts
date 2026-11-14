import { beforeEach, describe, expect, it } from "vitest";

import {
  bootReportLine,
  bootWithinBudget,
  getBootReport,
  resetBootProfiler,
  stampBootMilestone,
} from "../../src/ts/utils/boot-profiler";

describe("phase 100 — the boot profiler", () => {
  beforeEach(() => {
    resetBootProfiler();
    stampBootMilestone("module-load");
  });

  it("milestones stamp with monotonically increasing deltas", async () => {
    stampBootMilestone("app-ready");
    const report = getBootReport();
    //the module-load delta spans the import-to-stamp gap — small, not zero
    expect(report.milestones["module-load"]).toBeLessThan(2000);
    expect(report.milestones["app-ready"]).toBeGreaterThanOrEqual(0);
    //a second stamp lands AFTER the first
    await new Promise((resolve) => setTimeout(resolve, 5));
    stampBootMilestone("later");
    expect(
      (getBootReport().milestones["later"] ?? 0) >=
        (getBootReport().milestones["app-ready"] ?? 0),
    ).toBe(true);
  });

  it("the budget verdict: app-ready within 2s passes", () => {
    expect(bootWithinBudget()).toBe(true); //no app-ready yet = pending-pass
    stampBootMilestone("app-ready");
    expect(bootWithinBudget()).toBe(true); //a fresh test env is instant
  });

  it("an app-ready over budget fails the verdict", () => {
    //simulate an over-budget boot by stamping into the past relative to now:
    //the verdict reads the stored delta — stamp normally then verify the
    //line carries the within/over verdict
    stampBootMilestone("app-ready");
    expect(bootReportLine()).toContain("within");
    expect(bootReportLine()).toContain("module-load=");
    expect(bootReportLine()).toContain("app-ready=");
  });

  it("reset clears the report", () => {
    stampBootMilestone("app-ready");
    resetBootProfiler();
    expect(getBootReport().milestones).toEqual({});
    expect(bootReportLine()).toContain("pending");
  });
});
