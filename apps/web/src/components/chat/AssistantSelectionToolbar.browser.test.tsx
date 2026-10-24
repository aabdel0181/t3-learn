import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { askSelectionInSideChat } from "../sideChat/sideChatSelectionRegistry";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const environmentId = EnvironmentId.make("environment-local");
const threadRef = { environmentId, threadId: ThreadId.make("lesson-1") };
const REPLY = "The agent reads its observation space every step.";

type ToolbarProps = ComponentProps<typeof AssistantSelectionToolbar>;
const accept = () => true;

function Reply({
  text = REPLY,
  onCite = accept,
  ...actions
}: Partial<Omit<ToolbarProps, "viewport" | "threadRef">> & { text?: string }) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <div ref={setViewport} data-assistant-citation-viewport="">
      <div
        data-assistant-citation-source="assistant-1"
        data-assistant-citation-environment={environmentId}
        data-assistant-citation-thread="lesson-1"
      >
        <p>{text}</p>
      </div>
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={threadRef}
        onCite={onCite}
        {...actions}
      />
    </div>
  );
}

function select(container: HTMLElement, start: number, end: number) {
  const text = container.querySelector("p")?.firstChild;
  if (!text) throw new Error("Reply text did not render");
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

const toolbar = () => page.getByRole("toolbar", { name: "Selection actions" });
const citeButton = () => page.getByRole("button", { name: "Cite selection in composer" });
const askButton = () => page.getByRole("button", { name: "Ask in side chat" });

describe("AssistantSelectionToolbar", () => {
  it("offers Cite and Ask in side chat, reachable with Tab and the arrow keys", async () => {
    await using screen = await render(<Reply onAskInSideChat={() => true} />);
    select(screen.container, 20, 37);
    await expect.element(askButton()).toBeVisible();

    await userEvent.keyboard("{Tab}");
    await expect.element(citeButton()).toHaveFocus();
    await expect.element(citeButton()).toHaveAttribute("tabindex", "0");
    await expect.element(askButton()).toHaveAttribute("tabindex", "-1");

    await userEvent.keyboard("{ArrowRight}");
    await expect.element(askButton()).toHaveFocus();
    await expect.element(askButton()).toHaveAttribute("tabindex", "0");
    await expect.element(citeButton()).toHaveAttribute("tabindex", "-1");

    await userEvent.keyboard("{ArrowRight}");
    await expect.element(citeButton()).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(askButton()).toHaveFocus();
  });

  it("asks about the selected text and clears the selection", async () => {
    const onAskInSideChat = vi.fn(() => true);
    await using screen = await render(<Reply onAskInSideChat={onAskInSideChat} />);
    select(screen.container, 20, 37);

    await askButton().click();

    expect(onAskInSideChat).toHaveBeenCalledWith(
      {
        version: 1,
        environmentId,
        threadId: "lesson-1",
        messageId: "assistant-1",
        text: "observation space",
        start: 20,
        end: 37,
        prefix: "The agent reads its ",
        suffix: " every step.",
      },
      expect.objectContaining({ source: expect.any(HTMLElement) }),
    );
    expect(window.getSelection()?.isCollapsed).toBe(true);
    await expect.element(toolbar()).not.toBeInTheDocument();
  });

  it("keeps Ask disabled while the reply streams and says why", async () => {
    const onAskInSideChat = vi.fn(() => true);
    await using screen = await render(
      <Reply
        onAskInSideChat={onAskInSideChat}
        streamingMessageId={MessageId.make("assistant-1")}
      />,
    );
    select(screen.container, 20, 37);

    await expect.element(askButton()).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(askButton())
      .toHaveAttribute("aria-description", "Available when this reply finishes");
    await askButton().click({ force: true });

    expect(onAskInSideChat).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe("observation space");
    await expect.element(toolbar()).toBeInTheDocument();
  });

  it("keeps Ask disabled while another side chat is starting", async () => {
    await using screen = await render(<Reply onAskInSideChat={() => true} askPending />);
    select(screen.container, 20, 37);

    await expect.element(askButton()).toHaveAttribute("aria-disabled", "true");
    await expect.element(askButton()).toHaveAttribute("aria-description", "Starting side chat…");
  });

  it("shows why Ask waits and still dismisses on one Escape", async () => {
    await using screen = await render(<Reply onAskInSideChat={() => true} askPending />);
    select(screen.container, 20, 37);
    await expect.element(askButton()).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(askButton()).toHaveFocus();
    await expect.element(page.getByText("Starting side chat…")).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await expect.element(toolbar()).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe("observation space");
  });

  it("reads Shorten selection above 4,000 characters but still cites", async () => {
    const onCite = vi.fn(() => true);
    await using screen = await render(
      <Reply text={"word ".repeat(900)} onCite={onCite} onAskInSideChat={() => true} />,
    );
    select(screen.container, 0, 4001);

    const tooLong = page.getByRole("button", { name: "Shorten selection to ask in side chat" });
    await expect.element(tooLong).toHaveTextContent("Shorten selection");
    await expect.element(tooLong).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(tooLong)
      .toHaveAttribute("aria-description", "Side chats take up to 4,000 characters");
    await expect.element(citeButton()).toBeEnabled();

    await citeButton().click();
    expect(onCite).toHaveBeenCalledOnce();
  });

  it("offers only Cite when the environment has no side chats", async () => {
    await using screen = await render(<Reply />);
    select(screen.container, 20, 37);

    await expect.element(citeButton()).toBeVisible();
    await expect.element(askButton()).not.toBeInTheDocument();
  });

  it("stays inside the right-panel sheet so the sheet's focus trap keeps it usable", async () => {
    await using screen = await render(
      <div data-slot="sheet-popup" className="fixed top-0 right-0 bottom-0 w-96">
        <Reply onAskInSideChat={() => true} />
      </div>,
    );
    select(screen.container, 20, 37);
    await expect.element(askButton()).toBeVisible();

    expect(toolbar().element().parentElement).toBe(
      screen.container.querySelector('[data-slot="sheet-popup"]'),
    );
  });

  it("places the toolbar by the sheet's own corner when the sheet is offset and transformed", async () => {
    await using screen = await render(
      <div
        data-slot="sheet-popup"
        className="fixed top-40 left-12 w-96 border-s will-change-transform"
        style={{ translate: "12px 0" }}
      >
        <Reply onAskInSideChat={() => true} />
      </div>,
    );
    // Early in the first line, so the toolbar fits beside the selection and the window-edge clamp
    // stays out of the way.
    select(screen.container, 4, 9);
    await expect.element(askButton()).toBeVisible();

    // The toolbar opens at the selection's last line, right edge and 4px below its bottom.
    const selected = Array.from(window.getSelection()!.getRangeAt(0).getClientRects()).at(-1)!;
    const actions = toolbar().element().getBoundingClientRect();
    expect(selected.right + actions.width + 8).toBeLessThan(window.innerWidth);
    // Under half a pixel, so the sheet's 1px start border (clientLeft) is pinned as well.
    expect(Math.abs(actions.left - selected.right)).toBeLessThan(0.5);
    expect(Math.abs(actions.top - (selected.bottom + 4))).toBeLessThan(8);
  });

  it("dismisses both actions on Escape", async () => {
    const onCite = vi.fn(() => true);
    const onAskInSideChat = vi.fn(() => true);
    await using screen = await render(<Reply onCite={onCite} onAskInSideChat={onAskInSideChat} />);
    select(screen.container, 20, 37);
    await expect.element(askButton()).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(askButton()).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect.element(toolbar()).not.toBeInTheDocument();
    expect(onAskInSideChat).not.toHaveBeenCalled();
    expect(onCite).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe("observation space");
  });

  it("still asks from the shortcut after Escape hides the toolbar but keeps the selection", async () => {
    const onAskInSideChat = vi.fn(() => true);
    await using screen = await render(<Reply onAskInSideChat={onAskInSideChat} />);
    select(screen.container, 20, 37);
    await expect.element(askButton()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(toolbar()).not.toBeInTheDocument();

    expect(askSelectionInSideChat(window.getSelection())).toBe(true);
    expect(onAskInSideChat).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "assistant-1", text: "observation space" }),
      expect.objectContaining({ source: expect.any(HTMLElement) }),
    );
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("lets the shortcut through when the selection cannot be asked about", async () => {
    const onAskInSideChat = vi.fn(() => true);
    await using screen = await render(
      <Reply
        onAskInSideChat={onAskInSideChat}
        streamingMessageId={MessageId.make("assistant-1")}
      />,
    );
    select(screen.container, 20, 37);
    await expect.element(askButton()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(toolbar()).not.toBeInTheDocument();

    expect(askSelectionInSideChat(window.getSelection())).toBe(false);
    expect(onAskInSideChat).not.toHaveBeenCalled();
  });
});
