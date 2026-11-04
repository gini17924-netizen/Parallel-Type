import { describe, it, expect, beforeEach, vi } from "vitest";
import * as List from "../src/list";
import * as Validation from "../src/validation";
import { FunboxMetadata } from "../src/types";

describe("validation", () => {
  describe("checkCompatibility", () => {
    const getFunboxMock = vi.spyOn(List, "getFunbox");

    beforeEach(() => {
      //mockReset (not mockClear): clears calls AND the implementation, so a
      //persistent mockReturnValue from an earlier test cannot poison later
      //ones — every test here starts from the real funbox list
      getFunboxMock.mockReset();
    });

    it("should pass without funboxNames", () => {
      //WHEN / THEN
      expect(Validation.checkCompatibility([])).toBe(true);
    });

    it("should fail for undefined funboxNames", () => {
      //GIVEN
      getFunboxMock.mockReturnValueOnce([
        {
          name: "plus_one",
        } as FunboxMetadata,
        undefined as unknown as FunboxMetadata,
      ]);

      //WHEN / THEN
      expect(Validation.checkCompatibility(["plus_one", "plus_two"])).toBe(
        false,
      );
    });

    it("should fail for undefined withFunbox param", () => {
      //GIVEN
      getFunboxMock
        .mockReturnValueOnce([])
        .mockReturnValue([undefined as unknown as FunboxMetadata]);

      //WHEN / THEN
      expect(
        Validation.checkCompatibility(["plus_one", "plus_two"], "plus_three"),
      ).toBe(false);
    });

    it("should check for optional withFunbox param ", () => {
      //GIVEN
      getFunboxMock
        .mockReturnValueOnce([
          {
            name: "plus_one",
            cssModifications: ["body", "main"],
          } as FunboxMetadata,
          {
            name: "plus_two",
          } as FunboxMetadata,
        ])
        .mockReturnValueOnce([
          {
            name: "plus_three",
            cssModifications: ["main", "typingTest"],
          } as FunboxMetadata,
        ]);

      //WHEN
      const result = Validation.checkCompatibility(
        ["plus_one", "plus_two"],
        "plus_three",
      );

      //THEN
      expect(result).toBe(false);

      expect(getFunboxMock).toHaveBeenNthCalledWith(1, [
        "plus_one",
        "plus_two",
      ]);
      expect(getFunboxMock).toHaveBeenNthCalledWith(2, "plus_three");
    });

    it("should reject two funboxes modifying the same css element", () => {
      //GIVEN
      getFunboxMock.mockReturnValueOnce([
        {
          name: "plus_one",
          cssModifications: ["body", "main"],
        } as FunboxMetadata,
        {
          name: "plus_two",
          cssModifications: ["main", "typingTest"],
        } as FunboxMetadata,
      ]);

      //WHEN / THEN
      expect(Validation.checkCompatibility(["plus_one", "plus_two"])).toBe(
        false,
      );
    });

    it("should allow growing_text with funboxes modifying other css elements", () => {
      //GIVEN (real list entries: growing_text claims "words", nausea claims "body")
      //WHEN / THEN
      expect(Validation.checkCompatibility(["growing_text", "nausea"])).toBe(
        true,
      );
      expect(Validation.checkCompatibility(["growing_text", "crt"])).toBe(true);
    });

    it("should reject growing_text with funboxes also modifying words", () => {
      //GIVEN (real list entries: earthquake/tts/backwards/asl claim "words")
      //WHEN / THEN
      expect(
        Validation.checkCompatibility(["growing_text", "earthquake"]),
      ).toBe(false);
      expect(Validation.checkCompatibility(["growing_text", "tts"])).toBe(
        false,
      );
      expect(Validation.checkCompatibility(["growing_text", "backwards"])).toBe(
        false,
      );
      expect(Validation.checkCompatibility(["growing_text", "asl"])).toBe(
        false,
      );
    });

    it("should allow two funboxes modifying different css elements", () => {
      //GIVEN
      getFunboxMock.mockReturnValueOnce([
        {
          name: "plus_one",
          cssModifications: ["body", "main"],
        } as FunboxMetadata,
        {
          name: "plus_two",
          cssModifications: ["words"],
        } as FunboxMetadata,
      ]);

      //WHEN / THEN
      expect(Validation.checkCompatibility(["plus_one", "plus_two"])).toBe(
        true,
      );
    });
    describe("should validate two funboxes modifying the wordset", () => {
      const testCases = [
        {
          firstFunction: "withWords",
          secondFunction: "withWords",
          compatible: false,
        },
        {
          firstFunction: "withWords",
          secondFunction: "getWord",
          compatible: false,
        },
        {
          firstFunction: "getWord",
          secondFunction: "pullSection",
          compatible: false,
        },
      ];

      it.for(testCases)(
        `expect $firstFunction and $secondFunction to be compatible $compatible`,
        ({ firstFunction, secondFunction, compatible }) => {
          //GIVEN
          getFunboxMock.mockReturnValueOnce([
            {
              name: "plus_one",
              frontendFunctions: [firstFunction],
            } as FunboxMetadata,
            {
              name: "plus_two",
              frontendFunctions: [secondFunction],
            } as FunboxMetadata,
          ]);

          //WHEN / THEN
          expect(Validation.checkCompatibility(["plus_one", "plus_two"])).toBe(
            compatible,
          );
        },
      );
    });
  });
});
