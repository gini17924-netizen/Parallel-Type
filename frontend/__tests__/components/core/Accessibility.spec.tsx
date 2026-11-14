import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AnimatedModal } from "../../../src/ts/components/common/AnimatedModal";
import { SkipLink } from "../../../src/ts/components/common/SkipLink";
import { isModalOpen, showModal } from "../../../src/ts/states/modals";

//jsdom lacks the dialog element's methods the shell calls on open/close
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(): void {
    this.removeAttribute("open");
  };
});

describe("phase 95 — the accessibility shell", () => {
  afterAll(() => {
    delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal;
    delete (HTMLDialogElement.prototype as { close?: unknown }).close;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the skip link targets the page body and announces itself", () => {
    const { container } = render(() => <SkipLink />);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="#main-content"]',
    );
    expect(link?.textContent).toContain("skip to content");
    //the link is hidden until focused (sr-only) and becomes visible on focus
    expect(link?.className).toContain("sr-only");
    expect(link?.className).toContain("focus:not-sr-only");
  });

  it("escape closes a modal through the shared shell", async () => {
    const { container } = render(() => (
      <AnimatedModal id="Contact" title="a11y probe">
        <div>probe body</div>
      </AnimatedModal>
    ));
    showModal("Contact");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("probe body");
      expect(isModalOpen("Contact")).toBe(true);
    });
    const dialog = container.querySelector<HTMLDialogElement>("#ContactModal");
    expect(dialog).not.toBeNull();
    fireEvent.keyDown(dialog as HTMLDialogElement, { key: "Escape" });
    await vi.waitFor(() => {
      expect(isModalOpen("Contact")).toBe(false);
    });
  });
});
