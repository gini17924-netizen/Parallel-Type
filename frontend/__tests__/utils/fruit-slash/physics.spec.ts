import { describe, expect, it } from "vitest";

import { apexTimeMs, stepArc } from "../../../src/ts/utils/fruit-slash/physics";

describe("fruit slash physics (idea G10 phase 1)", () => {
  it("integrates gravity then moves both axes", () => {
    const s = stepArc(50, 100, 10, -60, 0.5, 70);
    expect(s.vy).toBe(-60 + 70 * 0.5); //-25
    expect(s.x).toBe(50 + 10 * 0.5); //55
    expect(s.y).toBe(100 + -25 * 0.5); //87.5
  });

  it("the apex lands exactly at |vy0|/g", () => {
    expect(apexTimeMs(60, 70)).toBeCloseTo((60 / 70) * 1000, 6);
    expect(apexTimeMs(-80, 70)).toBeCloseTo((80 / 70) * 1000, 6);
    //marching the arc in 1ms steps: vy crosses zero at the apex moment
    const g = 70;
    const vy0 = -60;
    let vy = vy0;
    let t = 0;
    while (vy + g * 0.001 < 0) {
      t += 0.001;
      vy += g * 0.001;
    }
    expect(t * 1000).toBeCloseTo(apexTimeMs(vy0, g), 0);
  });
});
