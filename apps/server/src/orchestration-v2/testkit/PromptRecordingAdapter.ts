import {
  MessageId,
  type OrchestrationV2ProviderCapabilities,
  type ProviderDriverKind,
  type ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

export interface RecordedPrompt {
  readonly threadId: ThreadId;
  readonly text: string;
}

/**
 * A provider that records the prompt of every turn it starts. It has no `injectHistory`, so context
 * handoffs arrive inline in the prompt. Without `replyText` every turn stays running. With it, a
 * turn answers `replyText` and completes, unless its text contains `"[hold]"`: that turn stays
 * running until `finishHeldTurn` or an interrupt.
 */
export const makePromptRecordingAdapter = Effect.fn("makePromptRecordingAdapter")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly driver: ProviderDriverKind;
    readonly capabilities: OrchestrationV2ProviderCapabilities;
    readonly cwd: string;
    /** Every native resume fails, so each turn after the first binds a fresh native thread. */
    readonly failResume?: boolean;
    /** What every turn answers before it completes. */
    readonly replyText?: string;
  }) {
    const { instanceId, driver, capabilities, replyText } = input;
    const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
    const prompts: Array<RecordedPrompt> = [];
    const heldTurns = new Map<
      ThreadId,
      Deferred.Deferred<ProviderAdapter.ProviderAdapterV2TurnInput>
    >();
    let nativeThreadCount = 0;

    /** The turn held in `threadId`, which resolves once the provider has started it. */
    const heldTurn = (threadId: ThreadId) => {
      const existing = heldTurns.get(threadId);
      if (existing !== undefined) return existing;
      const created = Deferred.makeUnsafe<ProviderAdapter.ProviderAdapterV2TurnInput>();
      heldTurns.set(threadId, created);
      return created;
    };

    const providerTurnId = (turn: ProviderAdapter.ProviderAdapterV2TurnInput) =>
      ProviderTurnId.make(`provider-turn:${turn.attemptId}`);

    const publishProviderTurn = Effect.fn("PromptRecordingAdapter.publishProviderTurn")(function* (
      turn: ProviderAdapter.ProviderAdapterV2TurnInput,
      status: "running" | "completed" | "interrupted",
    ) {
      const now = yield* DateTime.now;
      yield* Queue.offer(events, {
        type: "provider_turn.updated",
        driver,
        providerTurn: {
          id: providerTurnId(turn),
          providerThreadId: turn.providerThread.id,
          nodeId: turn.rootNodeId,
          runAttemptId: turn.attemptId,
          nativeTurnRef: {
            driver,
            nativeId: `native:${turn.attemptId}`,
            strength: "strong",
          },
          ordinal: turn.providerTurnOrdinal,
          status,
          startedAt: now,
          completedAt: status === "running" ? null : now,
        },
      });
    });

    const publishTerminal = Effect.fn("PromptRecordingAdapter.publishTerminal")(function* (
      turn: ProviderAdapter.ProviderAdapterV2TurnInput,
      status: "completed" | "interrupted",
    ) {
      yield* publishProviderTurn(turn, status);
      yield* Queue.offer(events, {
        type: "turn.terminal",
        driver,
        providerThreadId: turn.providerThread.id,
        providerTurnId: providerTurnId(turn),
        runOrdinal: turn.runOrdinal,
        status,
        failure: null,
        threadDisposition: "reusable",
      });
    });

    const reply = Effect.fn("PromptRecordingAdapter.reply")(function* (
      turn: ProviderAdapter.ProviderAdapterV2TurnInput,
      text: string,
    ) {
      const now = yield* DateTime.now;
      const messageId = MessageId.make(`message:reply:${turn.attemptId}`);
      yield* Queue.offer(events, {
        type: "message.updated",
        driver,
        message: {
          createdBy: "agent",
          creationSource: "provider",
          id: messageId,
          threadId: turn.threadId,
          runId: turn.runId,
          nodeId: turn.rootNodeId,
          role: "assistant",
          text,
          attachments: [],
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* Queue.offer(events, {
        type: "turn_item.updated",
        driver,
        turnItem: {
          id: TurnItemId.make(`item:reply:${turn.attemptId}`),
          threadId: turn.threadId,
          runId: turn.runId,
          nodeId: turn.rootNodeId,
          providerThreadId: turn.providerThread.id,
          providerTurnId: providerTurnId(turn),
          nativeItemRef: null,
          parentItemId: null,
          ordinal: turn.runOrdinal * 100 + 1,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "assistant_message",
          messageId,
          text,
          streaming: false,
        },
      });
      yield* publishTerminal(turn, "completed");
    });

    /**
     * Answers and completes the turn held in `threadId`. A run is marked running before the
     * provider starts its turn, so this first waits for the provider to hold it.
     */
    const finishHeldTurn = Effect.fn("PromptRecordingAdapter.finishHeldTurn")(function* (
      threadId: ThreadId,
    ) {
      if (replyText === undefined) {
        return yield* Effect.die(new Error("Only an adapter with replyText holds turns."));
      }
      const turn = yield* Deferred.await(heldTurn(threadId));
      heldTurns.delete(threadId);
      yield* reply(turn, replyText);
    });

    const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
      instanceId,
      driver,
      getCapabilities: () => Effect.succeed(capabilities),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
      openSession: Effect.fn("PromptRecordingAdapter.openSession")(function* (session) {
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
            yield* publishProviderTurn(turn, "running");
            if (replyText === undefined) return;
            if (turn.message.text.includes("[hold]")) {
              yield* Deferred.succeed(heldTurn(turn.threadId), turn);
              return;
            }
            yield* reply(turn, replyText);
          }),
          steerTurn: () => Effect.void,
          interruptTurn: Effect.fn("PromptRecordingAdapter.interruptTurn")(function* (interrupt) {
            const threadId = interrupt.providerThread.appThreadId;
            const held = threadId === null ? undefined : heldTurns.get(threadId);
            if (held === undefined || !Deferred.isDoneUnsafe(held)) return;
            const turn = yield* Deferred.await(held);
            if (providerTurnId(turn) !== interrupt.providerTurnId) return;
            heldTurns.delete(turn.threadId);
            yield* publishTerminal(turn, "interrupted");
          }),
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
    };

    return { adapter, prompts, finishHeldTurn };
  },
);
