import { MessageId, ThreadId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import type { SideChatMark } from "../../state/entities";
import { SIDE_CHAT_MARK_HIGHLIGHT_NAME, SideChatMarks, SideChatMarksChip } from "./SideChatMarks";

const messageId = MessageId.make("assistant-1");

function mark(
  threadId: string,
  label: string,
  context: { readonly prefix: string; readonly suffix: string },
  start = 3,
): SideChatMark {
  return {
    threadId: ThreadId.make(threadId),
    label,
    state: "open",
    anchor: {
      threadId: ThreadId.make("lesson"),
      messageId,
      start,
      end: start + label.length,
      ...context,
    },
  };
}

const MARKS = [
  mark("side-1", "observation space", { prefix: "An ", suffix: " is what the agent can see." }),
  mark("side-2", "reward shaping", { prefix: "zzz", suffix: "qqq" }),
];

/** An assistant row: the marked reply, its tag layer, and the fallback chip beside the meta. */
function Row(props: {
  readonly onOpen: (threadId: ThreadId) => void;
  readonly text: ReactNode;
  readonly marks?: ReadonlyArray<SideChatMark>;
}) {
  const [unresolved, setUnresolved] = useState<ReadonlyArray<SideChatMark>>([]);
  return (
    <div className="relative">
      <div data-assistant-citation-source={messageId}>
        <p>{props.text}</p>
      </div>
      <SideChatMarks
        messageId={messageId}
        marks={props.marks ?? MARKS}
        onOpen={props.onOpen}
        onUnresolvedChange={setUnresolved}
      />
      <SideChatMarksChip marks={unresolved} onOpen={props.onOpen} />
    </div>
  );
}

function highlightedText(): ReadonlyArray<string> {
  const highlight = CSS.highlights.get(SIDE_CHAT_MARK_HIGHLIGHT_NAME);
  return highlight === undefined ? [] : [...highlight].map((range) => String(range as Range));
}

it("paints anchored side chats, opens them from their tag or the fallback chip, and survives a re-render", async () => {
  const onOpen = vi.fn();
  await using screen = await render(
    <Row onOpen={onOpen} text="An observation space is what the agent can see." />,
  );

  await vi.waitFor(() => expect(highlightedText()).toEqual(["observation space"]));
  await userEvent.click(screen.getByRole("button", { name: "Open side chat “observation space”" }));
  expect(onOpen).toHaveBeenLastCalledWith("side-1");
  await userEvent.click(screen.getByRole("button", { name: "↳ 1 side chat" }));
  expect(onOpen).toHaveBeenLastCalledWith("side-2");

  await screen.rerender(
    <Row
      onOpen={onOpen}
      text={
        <>
          {"An observ"}
          {"ation space is what the agent can see."}
        </>
      }
    />,
  );
  expect(screen.container.querySelector("p")?.childNodes).toHaveLength(2);
  await vi.waitFor(() => expect(highlightedText()).toEqual(["observation space"]));

  await screen.unmount();
  expect(CSS.highlights.has(SIDE_CHAT_MARK_HIGHLIGHT_NAME)).toBe(false);
});

it("keeps painting while a modal hides the page around the reply", async () => {
  // A modal, such as the narrow layout's side-chat sheet or the command palette,
  // sets aria-hidden on the column that holds the reply.
  const hiddenColumn = document.createElement("div");
  hiddenColumn.setAttribute("aria-hidden", "true");
  await using screen = await render(
    <Row onOpen={vi.fn()} text="An observation space is what the agent can see." />,
    { container: hiddenColumn },
  );

  expect(highlightedText()).toEqual(["observation space"]);
  expect(
    [...screen.container.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    ),
  ).toEqual(["Open side chat “observation space”", "↳ 1 side chat"]);
});

it("gives marks that end on the same line one tag that lists them", async () => {
  const onOpen = vi.fn();
  await using screen = await render(
    <Row
      onOpen={onOpen}
      text="An observation space and a reward signal."
      marks={[
        mark("side-1", "observation space", { prefix: "An ", suffix: " and a reward signal." }),
        mark("side-3", "reward signal", { prefix: "space and a ", suffix: "." }, 27),
      ]}
    />,
  );
  await vi.waitFor(() => expect(highlightedText()).toEqual(["observation space", "reward signal"]));

  await userEvent.click(screen.getByRole("button", { name: "Open one of 2 side chats" }));
  await userEvent.click(page.getByRole("menuitem", { name: "reward signal" }));
  expect(onOpen).toHaveBeenLastCalledWith("side-3");
});
