import {
  ContextTransferId,
  OrchestrationV2Actor,
  OrchestrationV2AppThread,
  OrchestrationV2ContextSourcePoint,
  OrchestrationV2ContextTransfer,
  OrchestrationV2CreationSource,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2Run,
  OrchestrationV2SideChat,
  OrchestrationV2ThreadProjection,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export interface ThreadForkPlanV2 {
  readonly targetThread: OrchestrationV2AppThread;
  readonly transfer: OrchestrationV2ContextTransfer;
}

export class ThreadForkPlanError extends Schema.TaggedError<ThreadForkPlanError>()(
  "ThreadForkPlanError",
  {
    sourceThreadId: ThreadId,
    targetThreadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** waiting means provider-finished with checkpoint capture pending. */
export function isForkableSourceRunStatus(status: OrchestrationV2Run["status"]): boolean {
  return (
    status === "completed" ||
    status === "waiting" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "cancelled"
  );
}

export function forkableSourceRunStatusError(
  run: Pick<OrchestrationV2Run, "id" | "status">,
): string {
  return `Fork source run ${run.id} is ${run.status}; in-progress and rolled-back runs cannot be forked.`;
}

/**
 * The settings-copy half of planning a thread from another one: provider, model, modes, worktree,
 * branch and lineage under the source. Side-chat state belongs to the source alone, so it never
 * follows into the target.
 */
function planForkTargetThread(input: {
  readonly sourceThread: OrchestrationV2AppThread;
  readonly targetThreadId: ThreadId;
  readonly title: string;
  readonly forkedFrom: OrchestrationV2AppThread["forkedFrom"];
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
  readonly createdAt: DateTime.Utc;
}): OrchestrationV2AppThread {
  const {
    sideChat: _sideChat,
    sideChatNoteDeliveries: _sideChatNoteDeliveries,
    ...sourceThread
  } = input.sourceThread;
  return {
    ...sourceThread,
    // PR context follows the conversation; watching remains the source thread's responsibility.
    pullRequests: sourceThread.pullRequests?.map(({ watch: _watch, ...link }) => link),
    createdBy: input.createdBy,
    creationSource: input.creationSource,
    id: input.targetThreadId,
    title: input.title,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: sourceThread.id,
      relationshipToParent: "fork",
      rootThreadId: sourceThread.lineage.rootThreadId,
    },
    forkedFrom: input.forkedFrom,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    // A guest link belongs to the thread it was made for.
    guestShare: null,
    lastVisitedAt: null,
    // A fork is a new thread; it does not inherit how often the source was opened.
    opens: null,
    deletedAt: null,
  };
}

/**
 * Plans a side chat as a child of its anchor thread. It reuses the fork settings copy but is not a
 * fork: no source run, no context transfer, and nothing of the anchor's own pins, title
 * regeneration, limit recovery, history origin, pull requests or rollback state.
 */
export function planSideChatThread(input: {
  readonly anchorThread: OrchestrationV2AppThread;
  readonly threadId: ThreadId;
  readonly sideChat: OrchestrationV2SideChat;
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
  readonly createdAt: DateTime.Utc;
}): OrchestrationV2AppThread {
  const {
    pinnedAt: _pinnedAt,
    pinOrderKey: _pinOrderKey,
    titleRegeneration: _titleRegeneration,
    limitRecovery: _limitRecovery,
    historyOrigin: _historyOrigin,
    pullRequests: _pullRequests,
    linkedPullRequest: _linkedPullRequest,
    branchPullRequest: _branchPullRequest,
    rollbackRequestId: _rollbackRequestId,
    rollbackFailure: _rollbackFailure,
    ...thread
  } = planForkTargetThread({
    sourceThread: input.anchorThread,
    targetThreadId: input.threadId,
    title: input.sideChat.label,
    forkedFrom: null,
    createdBy: input.createdBy,
    creationSource: input.creationSource,
    createdAt: input.createdAt,
  });
  return { ...thread, sideChat: input.sideChat };
}

export interface ThreadForkServiceV2Shape {
  readonly plan: (input: {
    readonly sourceProjection: Pick<OrchestrationV2ThreadProjection, "thread">;
    readonly sourceRun: OrchestrationV2Run;
    readonly sourceProviderThread: OrchestrationV2ProviderThread | undefined;
    readonly sourceTokenUsage?: OrchestrationV2ProviderTurnTokenUsage | undefined;
    readonly canonicalSourcePoint: OrchestrationV2ContextSourcePoint;
    readonly transferId: ContextTransferId;
    readonly targetThreadId: ThreadId;
    readonly title?: string;
    readonly createdBy: OrchestrationV2Actor;
    readonly creationSource: OrchestrationV2CreationSource;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<ThreadForkPlanV2, ThreadForkPlanError>;
}

export class ThreadForkServiceV2 extends Context.Service<
  ThreadForkServiceV2,
  ThreadForkServiceV2Shape
>()("t3/orchestration-v2/ThreadForkService/ThreadForkServiceV2") {}

export const layer: Layer.Layer<ThreadForkServiceV2> = Layer.succeed(
  ThreadForkServiceV2,
  ThreadForkServiceV2.of({
    plan: Effect.fn("ThreadForkService.plan")(function* (input) {
      if (!isForkableSourceRunStatus(input.sourceRun.status)) {
        return yield* new ThreadForkPlanError({
          sourceThreadId: input.sourceProjection.thread.id,
          targetThreadId: input.targetThreadId,
          cause: forkableSourceRunStatusError(input.sourceRun),
        });
      }
      const targetThread = planForkTargetThread({
        sourceThread: input.sourceProjection.thread,
        targetThreadId: input.targetThreadId,
        title: input.title ?? `${input.sourceProjection.thread.title} fork`,
        forkedFrom: {
          type: "run",
          threadId: input.sourceProjection.thread.id,
          runId: input.sourceRun.id,
        },
        createdBy: input.createdBy,
        creationSource: input.creationSource,
        createdAt: input.createdAt,
      });
      const transfer: OrchestrationV2ContextTransfer = {
        id: input.transferId,
        type: "fork",
        sourceThreadId: input.sourceProjection.thread.id,
        targetThreadId: input.targetThreadId,
        sourcePoint: input.canonicalSourcePoint,
        basePoint: null,
        sourceProviderInstanceId: input.sourceRun.providerInstanceId,
        // Only native forks retain this context; portable handoffs rebuild it.
        sourceTokenUsage:
          (input.sourceRun.status === "completed" || input.sourceRun.status === "waiting") &&
          input.sourceProviderThread?.nativeThreadRef?.strength === "strong"
            ? input.sourceTokenUsage
            : undefined,
        targetProviderInstanceId: null,
        targetRunId: null,
        status: "pending",
        resolution: null,
        createdBy: input.createdBy,
        error:
          input.sourceProviderThread?.nativeThreadRef?.strength === "strong"
            ? null
            : "Source provider thread does not expose a strong native thread ref.",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        consumedAt: null,
      };
      return { targetThread, transfer };
    }),
  }),
);
