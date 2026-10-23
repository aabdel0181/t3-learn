import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
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

    const tooLong = page.getByRole("button", { name: "Selection is too long to ask about" });
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
});
