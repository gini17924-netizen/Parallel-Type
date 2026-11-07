import { describe, expect, it } from "vitest";

import { createFireSim } from "../../../src/ts/utils/firefight/sim";

describe("debug sim direct", () => {
  it("probes the object shape", () => {
    const sim = createFireSim({
      wordFor: () => "blaze",
      rng: () => 0.5,
      surviveMs: 3000,
    });
    sim.tick(50);
    console.log("keys:", Object.keys(sim).join(","));
    console.log("elapsedMs prop:", sim.elapsedMs);
    console.log(
      "descriptor:",
      JSON.stringify(Object.getOwnPropertyDescriptor(sim, "elapsedMs")),
    );
    console.log("tick source:", sim.tick.toString().slice(0, 400));
    expect(sim.elapsedMs).toBe(50);
  });
});
