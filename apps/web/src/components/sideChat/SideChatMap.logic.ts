import type { SideChatTreeRow } from "@t3tools/client-runtime/state/thread-relationships";
import type { ThreadId } from "@t3tools/contracts";

import type { SideChatTreeLayoutOptions } from "../../lib/sideChatTreeLayout";

export const SIDE_CHAT_MAP_LAYOUT: SideChatTreeLayoutOptions = {
  nodeWidth: 112,
  nodeHeight: 26,
  gapX: 8,
  gapY: 48,
};

/**
 * Where an arrow key moves focus in the map. `rows` are in preorder, so a
 * parent's children appear in sibling order and the first one is the first child.
 */
export function resolveSideChatMapKeyTarget(
  rows: ReadonlyArray<SideChatTreeRow>,
  fromThreadId: ThreadId,
  key: string,
): ThreadId | null {
  const from = rows.find((row) => row.threadId === fromThreadId);
  if (from === undefined) return null;

  switch (key) {
    case "ArrowUp":
      return rows.find((row) => row.threadId === from.parentId)?.threadId ?? null;
    case "ArrowDown":
      return rows.find((row) => row.parentId === from.threadId)?.threadId ?? null;
    case "ArrowLeft":
    case "ArrowRight": {
      const siblings = rows.filter((row) => row.parentId === from.parentId);
      const step = key === "ArrowLeft" ? -1 : 1;
      return siblings[siblings.indexOf(from) + step]?.threadId ?? null;
    }
    default:
      return null;
  }
}

/** The status `ThreadRelationshipIcon` colours the node's dot for. */
export function sideChatMapNodeStatus(
  row: Pick<SideChatTreeRow, "state" | "noteStatus">,
): "in_progress" | "pending" | "failed" | "completed" | null {
  if (row.state === "lesson") return null;
  if (row.state === "open") return "in_progress";
  switch (row.noteStatus) {
    case "generating":
      return "pending";
    case "failed":
      return "failed";
    case "ready":
    case "none":
      return "completed";
    case null:
      return null;
  }
}

/** The state in words, for assistive tech: the dot's colour is not enough on its own. */
export function sideChatMapNodeDescription(
  row: Pick<SideChatTreeRow, "state" | "noteStatus">,
): string {
  if (row.state === "lesson") return "Lesson";
  if (row.state === "open") return "Open";
  switch (row.noteStatus) {
    case "generating":
      return "Done, writing note";
    case "failed":
      return "Done, couldn't write the note";
    case "ready":
      return "Done, note ready";
    case "none":
      return "Done, no note needed";
    case null:
      return "Done";
  }
}

/** Shrinks content wider than the panel to fit it; never enlarges it. */
export function fitSideChatMapScale(contentWidth: number, availableWidth: number): number {
  return contentWidth <= 0 || availableWidth <= 0 ? 1 : Math.min(1, availableWidth / contentWidth);
}
