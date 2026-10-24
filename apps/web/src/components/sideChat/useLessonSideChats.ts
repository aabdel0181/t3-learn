import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { AssistantCitation, OrchestrationV2Run, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import type { AssistantCitationSourceAnchor } from "../../lib/assistantTextSelection";
import { useRightPanelStore } from "../../rightPanelStore";
import { useSideChatTreeShells } from "../../state/entities";
import { useEnvironmentShellStatus } from "../../state/shell";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { isThreadRouteSnapshotAuthoritative } from "../../threadRoutes";
import { askInSideChat } from "./openSideChat";
import {
  pendingSideChatThreadIds,
  selectStartingSideChat,
  usePendingSideChatStore,
} from "./pendingSideChatStore";
import { revealSideChat } from "./sideChatNavigation";
import { lessonSideChatWaitLabel, sideChatAwaitingInput } from "./sideChatPanel.logic";

/**
 * The lesson's side chats as its chat view uses them: Ask from the lesson's replies,
 * tab labels, the note wait label, and tabs kept in step with the side chats that exist.
 */
export function useLessonSideChats(input: {
  /** Null for drafts and for a route that is itself a side chat. */
  readonly lessonRef: ScopedThreadRef | null;
  /** The environment advertises `capabilities.sideChats`. */
  readonly supported: boolean;
  /** The server config, which can arrive after the shells, has said whether `supported`. */
  readonly capabilityKnown: boolean;
  readonly activityRunStatus: OrchestrationV2Run["status"] | null;
}): {
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly labelsById: ReadonlyMap<string, string>;
  readonly askPending: boolean;
  readonly noteWaitLabel: "Adding side-chat note…" | null;
  readonly onAskInSideChat:
    | ((citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
} {
  const { lessonRef, supported, capabilityKnown, activityRunStatus } = input;
  const shells = useSideChatTreeShells(supported ? lessonRef : null);
  const shellLive = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(lessonRef?.environmentId ?? null),
  );
  const run = useOrchestrationCommand(threadEnvironment.openSideChat, { reportFailure: false });
  const lessonKey = lessonRef === null ? null : scopedThreadKey(lessonRef);
  const askPending = usePendingSideChatStore((state) => selectStartingSideChat(state, lessonKey));

  useEffect(() => {
    // The shells cached from the last visit can predate side chats asked for just
    // before a reload, so only the live shell can say a side chat is gone.
    if (lessonRef === null || !capabilityKnown || !shellLive) return;
    const key = scopedThreadKey(lessonRef);
    const shellIds = new Set<string>(shells.map((shell) => shell.id));
    usePendingSideChatStore.getState().prune(key, shellIds);
    const live = new Set([
      ...shellIds,
      ...pendingSideChatThreadIds(usePendingSideChatStore.getState(), key),
    ]);
    useRightPanelStore.getState().reconcileSideChatSurfaces(lessonRef, live, supported);
  }, [capabilityKnown, lessonRef, shellLive, shells, supported]);

  const awaitingId = sideChatAwaitingInput(shells);
  useEffect(() => {
    if (lessonRef === null || awaitingId === null) return;
    revealSideChat(lessonRef, awaitingId, true);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Only a side chat that starts waiting opens, so one the user closed while it waits stays closed.
  }, [awaitingId]);

  const ask = useStableCallback((citation: AssistantCitation) => {
    if (lessonRef === null) return false;
    return askInSideChat({ lessonRef, citation, sideChatShells: shells, topThreadId: null, run });
  });

  return {
    shells,
    labelsById: new Map(
      shells.flatMap((shell) =>
        shell.sideChat == null ? [] : [[shell.id as string, shell.sideChat.label] as const],
      ),
    ),
    askPending,
    noteWaitLabel:
      lessonRef === null
        ? null
        : lessonSideChatWaitLabel({
            lessonThreadId: lessonRef.threadId,
            activityRunStatus,
            shells,
          }),
    onAskInSideChat: supported && lessonRef !== null ? ask : undefined,
  };
}
