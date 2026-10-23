import type { SideChatTreeRow } from "@t3tools/client-runtime/state/thread-relationships";
import { ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render, type Screen } from "../../../test/render";
import { SideChatMap } from "./SideChatMap";

function row(
  id: string,
  parentId: string | null,
  depth: number,
  label: string,
  state: SideChatTreeRow["state"] = "open",
  noteStatus: SideChatTreeRow["noteStatus"] = null,
): SideChatTreeRow {
  return {
    threadId: ThreadId.make(id),
    parentId: parentId === null ? null : ThreadId.make(parentId),
    depth,
    label,
    state,
    noteStatus,
  };
}

const RL_TREE = [
  row("lesson", null, 0, "RL environments", "lesson"),
  row("a", "lesson", 1, "observation space"),
  row("a1", "a", 2, "Box", "done", "ready"),
  row("b", "lesson", 1, "reward shaping", "done", "none"),
  row("b1", "b", 2, "sparse reward"),
  row("c", "lesson", 1, "episode"),
];

const node = (screen: Screen, name: string) => screen.getByRole("treeitem", { name, exact: true });

it("walks the tree with arrow keys and opens the focused node with Enter", async () => {
  const onOpenSideChat = vi.fn();
  const onFocusLesson = vi.fn();
  await using screen = await render(
    <SideChatMap
      rows={RL_TREE}
      currentThreadId={ThreadId.make("b")}
      onOpenSideChat={onOpenSideChat}
      onFocusLesson={onFocusLesson}
    />,
  );

  await expect.element(node(screen, "reward shaping")).toHaveAttribute("aria-selected", "true");
  await expect.element(node(screen, "reward shaping")).toHaveAttribute("tabindex", "0");
  await expect.element(node(screen, "RL environments")).toHaveAttribute("aria-level", "1");
  await expect.element(node(screen, "Box")).toHaveAttribute("aria-level", "3");

  (node(screen, "reward shaping").element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(node(screen, "RL environments")).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(node(screen, "observation space")).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(node(screen, "reward shaping")).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(node(screen, "sparse reward")).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(onOpenSideChat).toHaveBeenCalledExactlyOnceWith(ThreadId.make("b1"));

  await userEvent.click(node(screen, "episode"));
  expect(onOpenSideChat).toHaveBeenLastCalledWith(ThreadId.make("c"));
  await userEvent.click(node(screen, "RL environments"));
  expect(onFocusLesson).toHaveBeenCalledOnce();
});
