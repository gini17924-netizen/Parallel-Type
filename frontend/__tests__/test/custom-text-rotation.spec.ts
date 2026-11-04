import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CustomTextModule from "../../src/ts/test/custom-text";

/**
 * Behavioral coverage for the restart funnel gates (idea #5): the gates and
 * the round-robin order live in pickRotationForRestart; TestLogic.restart
 * calls it with the live gate values (see test-logic.ts restart()) and
 * applies the pick. The wrapper-level harness cannot mount the real
 * TestPage today (unhandled layout-resource rejection in jsdom — pre-existing).
 */
describe("pickRotationForRestart (restart funnel gates, idea #5)", () => {
  let CustomText: typeof CustomTextModule;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    CustomText = await import("../../src/ts/test/custom-text");
  });

  function seedTexts(): void {
    CustomText.setCustomText("w1", "alpha one");
    CustomText.setCustomText("w2", "beta two");
    CustomText.setCustomText("w3", "gamma three");
  }

  function fullGates(): {
    mode: string;
    withSameWordset: boolean;
    wasPractiseRestore: boolean;
    practiseBeforeMode: string | null;
    indicatorIsLong: boolean;
    indicatorName: string | undefined;
  } {
    return {
      mode: "custom",
      withSameWordset: false,
      wasPractiseRestore: false,
      practiseBeforeMode: null,
      indicatorIsLong: false,
      indicatorName: undefined,
    };
  }

  it("rotates 1 → 2 → 3 → 1 across consecutive restarts", () => {
    seedTexts();
    CustomText.setRotationState({
      enabled: true,
      pool: [
        { name: "w1", long: false },
        { name: "w2", long: false },
        { name: "w3", long: false },
      ],
      last: null,
    });
    //apply exactly like TestLogic.restart does after the pick - including
    //the commit (audit L8): the cursor advances only after a successful apply
    const apply = (pick: { name: string; long: boolean } | null): string[] => {
      if (pick === null) return CustomText.getText();
      const words = CustomText.getCustomText(pick.name, pick.long);
      CustomText.setPipeDelimiter(
        CustomText.getCustomTextIsPipeDelimiter(pick.name, pick.long),
      );
      CustomText.setText(words);
      CustomText.setLimitValue(words.length);
      CustomText.commitRotationCursor(pick.name);
      return CustomText.getText();
    };

    expect(apply(CustomText.pickRotationForRestart(fullGates()))).toStrictEqual(
      ["alpha", "one"],
    );
    expect(apply(CustomText.pickRotationForRestart(fullGates()))).toStrictEqual(
      ["beta", "two"],
    );
    expect(apply(CustomText.pickRotationForRestart(fullGates()))).toStrictEqual(
      ["gamma", "three"],
    );
    expect(apply(CustomText.pickRotationForRestart(fullGates()))).toStrictEqual(
      ["alpha", "one"],
    );
  });

  it("blocks repeated tests (withSameWordset)", () => {
    seedTexts();
    CustomText.setRotationState({
      enabled: true,
      pool: [{ name: "w1", long: false }],
      last: null,
    });
    expect(
      CustomText.pickRotationForRestart({
        ...fullGates(),
        withSameWordset: true,
      }),
    ).toBeNull();
    //the cursor is untouched: a later regular restart still picks w1
    expect(CustomText.pickRotationForRestart(fullGates())?.name).toBe("w1");
  });

  it("blocks practice-word restores", () => {
    seedTexts();
    CustomText.setRotationState({
      enabled: true,
      pool: [{ name: "w1", long: false }],
      last: null,
    });
    expect(
      CustomText.pickRotationForRestart({
        ...fullGates(),
        wasPractiseRestore: true,
        practiseBeforeMode: "custom",
      }),
    ).toBeNull();
    expect(CustomText.pickRotationForRestart(fullGates())?.name).toBe("w1");
  });

  it("blocks non-custom modes and long indicator texts", () => {
    seedTexts();
    CustomText.setRotationState({
      enabled: true,
      pool: [{ name: "w1", long: false }],
      last: null,
    });
    expect(
      CustomText.pickRotationForRestart({ ...fullGates(), mode: "time" }),
    ).toBeNull();
    expect(
      CustomText.pickRotationForRestart({
        ...fullGates(),
        indicatorIsLong: true,
        indicatorName: "book",
      }),
    ).toBeNull();
  });

  it("blocks synthetic indicator names (learning drills)", () => {
    seedTexts();
    CustomText.setRotationState({
      enabled: true,
      pool: [{ name: "w1", long: false }],
      last: null,
    });
    expect(
      CustomText.pickRotationForRestart({
        ...fullGates(),
        indicatorName: "learning drill",
      }),
    ).toBeNull();
    expect(CustomText.pickRotationForRestart(fullGates())?.name).toBe("w1");
  });
});
