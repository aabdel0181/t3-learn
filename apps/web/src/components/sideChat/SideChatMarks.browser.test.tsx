import { MessageId, ThreadId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import type { SideChatMark } from "../../state/entities";
import { SIDE_CHAT_MARK_HIGHLIGHT_NAME, SideChatMarks, SideChatMarksChip } from "./SideChatMarks";

const messageId = MessageId.make("assistant-1");

function mark(
  threadId: string,
  label: string,
  context: { readonly prefix: string; readonly suffix: string },
): SideChatMark {
  return {
    threadId: ThreadId.make(threadId),
    label,
    state: "open",
    anchor: { threadId: ThreadId.make("lesson"), messageId, start: 3, end: 20, ...context },
  };
}

const MARKS = [
  mark("side-1", "observation space", { prefix: "An ", suffix: " is what the agent can see." }),
  mark("side-2", "reward shaping", { prefix: "zzz", suffix: "qqq" }),
];

/** An assistant row: the marked reply, its tag layer, and the fallback chip beside the meta. */
function Row(props: { readonly onOpen: (threadId: ThreadId) => void; readonly text: ReactNode }) {
  const [unresolved, setUnresolved] = useState<ReadonlyArray<SideChatMark>>([]);
  return (
    <div className="relative">
      <div data-assistant-citation-source={messageId}>
        <p>{props.text}</p>
      </div>
      <SideChatMarks
        messageId={messageId}
        marks={MARKS}
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
