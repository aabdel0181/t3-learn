import {
  type OrchestrationV2ProviderCapabilities,
  type ProviderDriverKind,
  type ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type ThreadId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

export interface RecordedPrompt {
  readonly threadId: ThreadId;
  readonly text: string;
}

/**
 * A provider that records the prompt of every turn it starts and leaves the turn running. It has
 * no `injectHistory`, so context handoffs arrive inline in the prompt.
 */
export const makePromptRecordingAdapter = Effect.fn("makePromptRecordingAdapter")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly driver: ProviderDriverKind;
    readonly capabilities: OrchestrationV2ProviderCapabilities;
    readonly cwd: string;
    /** Every native resume fails, so each turn after the first binds a fresh native thread. */
    readonly failResume?: boolean;
    /** Runs whenever a session opens, before it is returned. */
    readonly onOpenSession?: Effect.Effect<void>;
  }) {
    const { instanceId, driver, capabilities } = input;
    const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
    const prompts: Array<RecordedPrompt> = [];
    let nativeThreadCount = 0;

    const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
      instanceId,
      driver,
      getCapabilities: () => Effect.succeed(capabilities),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
      openSession: Effect.fn("PromptRecordingAdapter.openSession")(function* (session) {
        if (input.onOpenSession !== undefined) yield* input.onOpenSession;
        const now = yield* DateTime.now;
        return {
          instanceId,
          driver,
          providerSessionId: session.providerSessionId,
          providerSession: {
            id: session.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd: input.cwd,
            model: session.modelSelection.model,
            capabilities,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: Effect.fn("PromptRecordingAdapter.ensureThread")(function* ({ threadId }) {
            nativeThreadCount += 1;
            const createdAt = yield* DateTime.now;
            return {
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: session.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: {
                driver,
                nativeId: `native:${threadId}:${nativeThreadCount}`,
                strength: "strong",
              },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt,
              updatedAt: createdAt,
            };
          }),
          resumeThread: ({ providerThread }) =>
            input.failResume === true
              ? Effect.fail(
                  new ProviderAdapter.ProviderAdapterResumeThreadError({
                    driver,
                    providerSessionId: session.providerSessionId,
                    providerThreadId: providerThread.id,
                    cause: "The native thread is gone.",
                  }),
                )
              : Effect.succeed(providerThread),
          startTurn: Effect.fn("PromptRecordingAdapter.startTurn")(function* (turn) {
            prompts.push({ threadId: turn.threadId, text: turn.message.text });
            yield* Queue.offer(events, {
              type: "provider_turn.updated",
              driver,
              providerTurn: {
                id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                providerThreadId: turn.providerThread.id,
                nodeId: turn.rootNodeId,
                runAttemptId: turn.attemptId,
                nativeTurnRef: {
                  driver,
                  nativeId: `native:${turn.attemptId}`,
                  strength: "strong",
                },
                ordinal: turn.providerTurnOrdinal,
                status: "running",
                startedAt: yield* DateTime.now,
                completedAt: null,
              },
            });
          }),
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
    };

    return { adapter, prompts };
  },
);
