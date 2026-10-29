import * as TestLogic from "../../test/test-logic";
import { toggleResultWords } from "../../test/words-history";
import {
  showErrorNotification,
  showSuccessNotification,
} from "../../states/notifications";
import * as TestWords from "../../test/test-words";
import { setConfig } from "../../config/setters";
import { getLastResult } from "../../states/snapshot";
import { Config } from "../../config/store";
import * as PractiseWords from "../../test/practise-words";
import { Command, CommandsSubgroup } from "../types";
import { getInputHistory } from "../../test/events/stats";
import { getLastEventLog, isTestFinished } from "../../states/test";
import { showModal } from "../../states/modals";
import {
  captureAndCopyToClipboard,
  captureAndDownload,
} from "../../test/screenshot";

const practiceSubgroup: CommandsSubgroup = {
  title: "Practice words...",
  list: [
    {
      id: "practiseWordsMissed",
      display: "missed",
      exec: (): void => {
        PractiseWords.init("words", false);
        void TestLogic.restart({
          practiseMissed: true,
        });
      },
    },
    {
      id: "practiseWordsSlow",
      display: "slow",
      exec: (): void => {
        PractiseWords.init("off", true);
        void TestLogic.restart({
          practiseMissed: true,
        });
      },
    },
    {
      id: "practiseWordsBoth",
      display: "both",
      exec: (): void => {
        PractiseWords.init("words", true);
        void TestLogic.restart({
          practiseMissed: true,
        });
      },
    },
    {
      id: "practiseWordsCustom",
      display: "custom...",
      opensModal: true,
      exec: (): void => {
        showModal("PractiseWords");
      },
    },
  ],
};

const commands: Command[] = [
  {
    id: "nextTest",
    display: "Next test",
    alias: "restart start begin type test typing",
    icon: "fa-chevron-right",
    available: (): boolean => {
      return isTestFinished();
    },
    exec: (): void => {
      void TestLogic.restart();
    },
  },
  {
    id: "repeatTest",
    display: "Repeat test",
    icon: "fa-sync-alt",
    exec: (): void => {
      void TestLogic.restart({
        withSameWordset: true,
      });
    },
    available: (): boolean => {
      return isTestFinished();
    },
  },
  {
    id: "practiseWords",
    display: "Practice words...",
    icon: "fa-exclamation-triangle",
    subgroup: practiceSubgroup,
    available: (): boolean => {
      return isTestFinished();
    },
  },
  {
    id: "toggleWordHistory",
    display: "Toggle word history",
    icon: "fa-align-left",
    exec: (): void => {
      toggleResultWords();
    },
    available: (): boolean => {
      return isTestFinished();
    },
  },
  {
    id: "raceYourGhost",
    display: "Race your ghost (pace caret at last result)",
    icon: "fa-ghost",
    alias: "ghost race pace caret last result",
    available: (): boolean => {
      const last = getLastResult();
      return last !== undefined && last.wpm > 0;
    },
    exec: (): void => {
      const last = getLastResult();
      if (last === undefined) return;
      setConfig("paceCaret", "custom");
      setConfig("paceCaretCustomSpeed", Math.round(last.wpm), {
        nosave: false,
      });
      showSuccessNotification(
        `Ghost caret set to ${Math.round(last.wpm)} wpm (your last result)`,
      );
    },
  },
  {
    id: "copyScreenshot",
    display: "Copy screenshot to clipboard",
    icon: "fa-copy",
    alias: "copy image clipboard",
    exec: (): void => {
      setTimeout(() => {
        void captureAndCopyToClipboard();
      }, 500);
    },
    available: (): boolean => {
      return isTestFinished();
    },
  },
  {
    id: "downloadScreenshot",
    display: "Download screenshot",
    icon: "fa-download",
    alias: "save image download file",
    exec: (): void => {
      setTimeout(async () => {
        void captureAndDownload();
      }, 500);
    },
    available: (): boolean => {
      return isTestFinished();
    },
  },
  {
    id: "copyWordsToClipboard",
    display: "Copy words to clipboard",
    icon: "fa-copy",
    exec: (): void => {
      const eventLog = getLastEventLog();
      if (eventLog === null) {
        showErrorNotification("No event log found!");
        return;
      }

      const inputHistory = getInputHistory(eventLog);
      const words =
        Config.mode === "zen"
          ? inputHistory.join("")
          : TestWords.words
              .get()
              .slice(0, inputHistory.length)
              .map((word) => word.textWithCommit)
              .join("");

      navigator.clipboard.writeText(words).then(
        () => {
          showSuccessNotification("Copied to clipboard");
        },
        () => {
          showErrorNotification("Failed to copy!");
        },
      );
    },
    available: (): boolean => {
      return isTestFinished();
    },
  },
];
export default commands;
