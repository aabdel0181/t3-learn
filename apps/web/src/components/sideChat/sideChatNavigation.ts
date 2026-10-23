import {
  deriveSideChatTree,
  type SideChatTreeRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { type SideChatSurface, useRightPanelStore } from "../../rightPanelStore";
import { readSideChatTreeShells } from "../../state/entities";
import { sideChatSurfacePath, topSideChatId } from "./sideChatPanel.logic";

/**
 * Shows `threadId` in its top-level side chat's tab on the lesson's panel, and
 * un-maximizes the panel so the lesson stays in view.
 */
export function revealSideChat(
  lessonRef: ScopedThreadRef,
  threadId: ThreadId,
  automatic = false,
): void {
  const rows = deriveSideChatTree(readSideChatTreeShells(lessonRef), lessonRef.threadId);
  const panels = useRightPanelStore.getState();
  panels.openSideChat(
    lessonRef,
    { topThreadId: topSideChatId(rows, threadId) ?? threadId, threadId },
    automatic,
  );
  panels.setMaximized(lessonRef, false);
}

/**
 * Leaves the side chat `surface` shows: the tab goes back to its parent side chat,
 * or closes when the side chat is a top-level one.
 */
export function leaveSideChat(
  lessonRef: ScopedThreadRef,
  surface: SideChatSurface,
  rows: ReadonlyArray<SideChatTreeRow>,
): void {
  const path = sideChatSurfacePath(rows, surface.threadId);
  const panels = useRightPanelStore.getState();
  if (path.length > 1) {
    panels.navigateSideChat(lessonRef, surface.id, path.slice(0, -1), path);
    return;
  }
  panels.closeSurface(lessonRef, surface.id);
}
