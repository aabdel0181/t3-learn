import type { SideChatTreeRow } from "@t3tools/client-runtime/state/thread-relationships";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutSideChatTree } from "./sideChatTreeLayout";

const OPTS = { nodeWidth: 112, nodeHeight: 26, gapX: 8, gapY: 48 };

function row(id: string, parentId: string | null, depth: number): SideChatTreeRow {
  return {
    threadId: ThreadId.make(id),
    parentId: parentId === null ? null : ThreadId.make(parentId),
    depth,
    label: id,
    state: depth === 0 ? "lesson" : "open",
    noteStatus: null,
  };
}

function box(id: string, x: number, y: number) {
  return { threadId: ThreadId.make(id), x, y, width: 112, height: 26 };
}

function edge(from: string, to: string, path: string) {
  return { from: ThreadId.make(from), to: ThreadId.make(to), path };
}

describe("layoutSideChatTree", () => {
  it("gives leaves consecutive slots, centres parents and stacks depths", () => {
    const layout = layoutSideChatTree(
      [
        row("lesson", null, 0),
        row("a", "lesson", 1),
        row("a1", "a", 2),
        row("b", "lesson", 1),
        row("b1", "b", 2),
        row("c", "lesson", 1),
      ],
      OPTS,
    );

    expect(layout.nodes).toEqual([
      box("lesson", 120, 0),
      box("a", 0, 74),
      box("a1", 0, 148),
      box("b", 120, 74),
      box("b1", 120, 148),
      box("c", 240, 74),
    ]);
    expect(layout.edges).toEqual([
      edge("lesson", "a", "M 176 26 C 176 50, 56 50, 56 74"),
      edge("a", "a1", "M 56 100 C 56 124, 56 124, 56 148"),
      edge("lesson", "b", "M 176 26 C 176 50, 176 50, 176 74"),
      edge("b", "b1", "M 176 100 C 176 124, 176 124, 176 148"),
      edge("lesson", "c", "M 176 26 C 176 50, 296 50, 296 74"),
    ]);
    expect([layout.width, layout.height]).toEqual([352, 174]);
  });

  it("centres a parent between its first and last child, not on their mean", () => {
    const layout = layoutSideChatTree(
      [
        row("lesson", null, 0),
        row("a", "lesson", 1),
        row("a1", "a", 2),
        row("a2", "a", 2),
        row("b", "lesson", 1),
        row("c", "lesson", 1),
      ],
      OPTS,
    );

    expect(layout.nodes.map((node) => [node.threadId, node.x])).toEqual([
      ["lesson", 210],
      ["a", 60],
      ["a1", 0],
      ["a2", 120],
      ["b", 240],
      ["c", 360],
    ]);
    expect(layout.width).toBe(472);
  });

  it("lays out a lone lesson, an empty tree and a row whose parent is missing", () => {
    expect(layoutSideChatTree([row("lesson", null, 0)], OPTS)).toEqual({
      nodes: [box("lesson", 0, 0)],
      edges: [],
      width: 112,
      height: 26,
    });
    expect(layoutSideChatTree([], OPTS)).toEqual({ nodes: [], edges: [], width: 0, height: 0 });

    const stray = layoutSideChatTree([row("lesson", null, 0), row("stray", "gone", 1)], OPTS);
    expect(stray.nodes[1]).toEqual(box("stray", 120, 74));
    expect(stray.edges).toEqual([]);
  });
});
