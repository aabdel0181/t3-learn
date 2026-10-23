import {
  type CommandId,
  ContextHandoffId,
  type NodeId,
  type OrchestrationV2ContextHandoff,
  type OrchestrationV2Run,
  type OrchestrationV2SideChat,
  type OrchestrationV2TurnItem,
  type ProviderThreadId,
  type RunId,
  SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
  type ThreadId,
  type TurnItemId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { PendingOrchestrationEffectV2 } from "../EffectOutbox.ts";
import type * as ProjectionStore from "../ProjectionStore.ts";

/** The outbox id of a side chat's opening summary. The open command's id is its request id. */
export function sideChatOpeningEffectId(requestId: string): string {
  return `effect:${requestId}:side-chat.opening`;
}

/** Writes the opening summary of the side chat that `commandId` opened. */
export function pendingSideChatOpeningEffect(
  commandId: CommandId,
  threadId: ThreadId,
): PendingOrchestrationEffectV2 {
  return {
    id: sideChatOpeningEffectId(commandId),
    commandId,
    threadId,
    request: { type: "side-chat.opening" },
  };
}

/** The opening context handed to the provider thread that `runId` starts fresh. */
export function sideChatOpeningHandoffId(runId: RunId): ContextHandoffId {
  return ContextHandoffId.make(`side-chat-opening:${runId}`);
}

export interface SideChatContextHandoff {
  readonly handoff: OrchestrationV2ContextHandoff;
  readonly turnItem: OrchestrationV2TurnItem;
}

/**
 * A side-chat handoff for `run` and the timeline item that shows it. The text goes in
 * `summaryText` with no `history`, so it reaches the provider inline with the run's prompt.
 * `ordinalOffset` places the item relative to the run's user message (`run.ordinal * 100`).
 */
export function buildSideChatContextHandoff(input: {
  readonly id: ContextHandoffId;
  readonly title: string;
  readonly ordinalOffset: number;
  readonly coveredRunOrdinals: OrchestrationV2ContextHandoff["coveredRunOrdinals"];
  readonly run: OrchestrationV2Run;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly summaryText: string;
  readonly turnItemId: TurnItemId;
  readonly createdAt: DateTime.Utc;
}): SideChatContextHandoff {
  const { run, createdAt } = input;
  return {
    handoff: {
      id: input.id,
      transferId: null,
      threadId: run.threadId,
      targetRunId: run.id,
      fromProviderThreadIds: [],
      toProviderThreadId: input.providerThreadId,
      coveredRunOrdinals: input.coveredRunOrdinals,
      strategy: "manual_context",
      status: "ready",
      summaryMessageId: null,
      summaryText: input.summaryText,
      createdByProviderInstanceId: null,
      createdAt,
      updatedAt: createdAt,
    },
    turnItem: {
      id: input.turnItemId,
      threadId: run.threadId,
      runId: run.id,
      nodeId: input.rootNodeId,
      providerThreadId: input.providerThreadId,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: run.ordinal * 100 + input.ordinalOffset,
      status: "completed",
      title: input.title,
      startedAt: createdAt,
      completedAt: createdAt,
      updatedAt: createdAt,
      type: "handoff",
      contextHandoffId: input.id,
      fromProviderThreadIds: [],
      toProviderThreadId: input.providerThreadId,
      fromProviderInstanceIds: [],
      toProviderInstanceId: run.providerInstanceId,
      fromModelSelections: [],
      toModel: run.modelSelection.model,
      strategy: "manual_context",
      summary: input.summaryText,
    },
  };
}

/** The opening context for a side chat run whose provider thread starts fresh. */
export function buildSideChatOpeningContext(input: {
  readonly run: OrchestrationV2Run;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly summaryText: string;
  readonly turnItemId: TurnItemId;
  readonly createdAt: DateTime.Utc;
}): SideChatContextHandoff {
  return buildSideChatContextHandoff({
    ...input,
    id: sideChatOpeningHandoffId(input.run.id),
    title: SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
    ordinalOffset: -1,
    coveredRunOrdinals: { from: 1, to: 1 },
  });
}

/**
 * What the opening context needs beyond the side chat itself: the lesson's first request, and the
 * opening summary of the side chat this one was opened from, if any.
 */
export const loadSideChatOpeningSources = Effect.fn("loadSideChatOpeningSources")(function* (
  projectionStore: Pick<ProjectionStore.ProjectionStoreV2Shape, "getThreadRecords">,
  sideChat: OrchestrationV2SideChat,
) {
  const lesson = yield* projectionStore.getThreadRecords(sideChat.lessonThreadId, ["messages"], {
    messageRoles: ["user"],
  });
  const parentOpeningText =
    sideChat.anchor.threadId === sideChat.lessonThreadId
      ? null
      : ((yield* projectionStore.getThreadRecords(sideChat.anchor.threadId, [])).thread.sideChat
          ?.opening.text ?? null);
  return {
    lessonTopic: lesson.messages[0]?.text ?? null,
    parentOpeningText,
  };
});
