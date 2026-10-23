import type { SideChatTreeRow } from "@t3tools/client-runtime/state/thread-relationships";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  fitSideChatMapScale,
  resolveSideChatMapKeyTarget,
  sideChatMapNodeDescription,
  sideChatMapNodeStatus,
} from "./SideChatMap.logic";

function row(
  id: string,
  parentId: string | null,
  depth: number,
  state: SideChatTreeRow["state"] = depth === 0 ? "lesson" : "open",
  noteStatus: SideChatTreeRow["noteStatus"] = null,
): SideChatTreeRow {
  return {
    threadId: ThreadId.make(id),
    parentId: parentId === null ? null : ThreadId.make(parentId),
    depth,
    label: id,
    state,
    noteStatus,
  };
}

const rows = [
  row("lesson", null, 0),
  row("a", "lesson", 1),
  row("a1", "a", 2),
  row("b", "lesson", 1),
  row("b1", "b", 2),
  row("c", "lesson", 1),
];

function keyTarget(from: string, key: string): string | null {
  return resolveSideChatMapKeyTarget(rows, ThreadId.make(from), key);
}

describe("resolveSideChatMapKeyTarget", () => {
  it("moves to the parent, the first child and the neighbouring siblings", () => {
    expect(keyTarget("a", "ArrowUp")).toBe("lesson");
    expect(keyTarget("a", "ArrowDown")).toBe("a1");
    expect(keyTarget("a", "ArrowRight")).toBe("b");
    expect(keyTarget("b", "ArrowLeft")).toBe("a");
    expect(keyTarget("c", "ArrowLeft")).toBe("b");
  });

  it("stops at the edges instead of wrapping", () => {
    expect(keyTarget("a", "ArrowLeft")).toBeNull();
    expect(keyTarget("c", "ArrowRight")).toBeNull();
    expect(keyTarget("lesson", "ArrowUp")).toBeNull();
    expect(keyTarget("lesson", "ArrowRight")).toBeNull();
    expect(keyTarget("a1", "ArrowRight")).toBeNull();
    expect(keyTarget("a1", "ArrowDown")).toBeNull();
  });

  it("goes from the lesson to its first side chat", () => {
    expect(keyTarget("lesson", "ArrowDown")).toBe("a");
  });

  it("ignores other keys and threads that are not in the map", () => {
    expect(keyTarget("a", "Enter")).toBeNull();
    expect(keyTarget("a", "Tab")).toBeNull();
    expect(keyTarget("gone", "ArrowDown")).toBeNull();
  });
});

describe("sideChatMapNodeStatus and sideChatMapNodeDescription", () => {
  it.each([
    { name: "lesson", state: "lesson", noteStatus: null, status: null, description: "Lesson" },
    { name: "open", state: "open", noteStatus: null, status: "in_progress", description: "Open" },
    {
      name: "done, writing the note",
      state: "done",
      noteStatus: "generating",
      status: "pending",
      description: "Done, writing note",
    },
    {
      name: "done, note failed",
      state: "done",
      noteStatus: "failed",
      status: "failed",
      description: "Done, couldn't write the note",
    },
    {
      name: "done, note ready",
      state: "done",
      noteStatus: "ready",
      status: "completed",
      description: "Done, note ready",
    },
    {
      name: "done, no note needed",
      state: "done",
      noteStatus: "none",
      status: "completed",
      description: "Done, no note needed",
    },
    {
      name: "done, no note status",
      state: "done",
      noteStatus: null,
      status: null,
      description: "Done",
    },
  ] as const)("$name", ({ state, noteStatus, status, description }) => {
    const node = row("x", "lesson", 1, state, noteStatus);
    expect(sideChatMapNodeStatus(node)).toBe(status);
    expect(sideChatMapNodeDescription(node)).toBe(description);
  });
});

describe("fitSideChatMapScale", () => {
  it("shrinks wide content to the available width and never enlarges it", () => {
    expect(fitSideChatMapScale(472, 236)).toBe(0.5);
    expect(fitSideChatMapScale(352, 600)).toBe(1);
  });

  it("stays at full size until a width is known", () => {
    expect(fitSideChatMapScale(0, 236)).toBe(1);
    expect(fitSideChatMapScale(472, 0)).toBe(1);
  });
});
