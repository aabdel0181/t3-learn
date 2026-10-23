import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProviderDriverKind,
  RunId,
  SIDE_CHAT_EXCERPT_MAX_CHARS,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../EffectOutbox.ts";
import * as EffectWorker from "../EffectWorker.ts";
import * as EventSink from "../EventSink.ts";
import * as Orchestrator from "../Orchestrator.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./ProviderReplayHarness.ts";
import {
  createLesson,
  LESSON_ANCHOR_MESSAGE_ID,
  LESSON_ANCHOR_TEXT,
  LESSON_MESSAGES,
  LESSON_SELECTION,
  LESSON_THREAD_ID,
  observationAnchor,
  openSideChatCommand,
  type SeedMessage,
  seedThreadMessages,
  SIDE_CHAT_THREAD_ID,
} from "./sideChatFixtures.ts";

const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
  instanceId: LESSON_SELECTION.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("Execution is paused: opening a side chat starts no provider turn"),
};

/** The orchestrator with a paused adapter and an effect worker that runs only when drained. */
function openHarness() {
  const layerDatabase = SqlitePersistence.layerMemory;
  return Layer.mergeAll(
    ProviderReplayHarness.layerWithRegistry(
      { name: "side-chat-open" },
      ProviderAdapterRegistry.layerFromAdapters([adapter]),
      { databaseLayer: layerDatabase, runEffectWorker: false },
    ),
    EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  );
}

const OPEN_REQUEST_ID = "command:side-chat:open";
const OBSERVATION_EXCERPT = "observation space";

const openOnObservation = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  return yield* orchestrator.dispatch(
    openSideChatCommand({
      commandId: OPEN_REQUEST_ID,
      threadId: SIDE_CHAT_THREAD_ID,
      anchor: observationAnchor(),
      excerpt: OBSERVATION_EXCERPT,
    }),
  );
});

const readThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return (yield* orchestrator.getThreadRecords(threadId, [])).thread;
  });

const withAnchorMessage = (change: Partial<SeedMessage>): ReadonlyArray<SeedMessage> =>
  LESSON_MESSAGES.map((message) =>
    message.id === LESSON_ANCHOR_MESSAGE_ID ? { ...message, ...change } : message,
  );

describe("thread.side_chat.open", () => {
  it.effect(
    "opens a side chat from a highlighted reply without a transfer, pins or title generation",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* createLesson();
        yield* orchestrator.dispatch({
          type: "thread.pin",
          commandId: CommandId.make("command:side-chat:pin-lesson"),
          threadId: LESSON_THREAD_ID,
        });
        assert.isDefined((yield* readThread(LESSON_THREAD_ID)).pinnedAt);

        yield* openOnObservation;

        const opened = yield* orchestrator.getThreadRecords(SIDE_CHAT_THREAD_ID, [
          "contextTransfers",
        ]);
        assert.equal(opened.thread.title, OBSERVATION_EXCERPT);
        assert.deepEqual(opened.thread.lineage, {
          parentThreadId: LESSON_THREAD_ID,
          relationshipToParent: "fork",
          rootThreadId: LESSON_THREAD_ID,
        });
        assert.isNull(opened.thread.forkedFrom);
        assert.isUndefined(opened.thread.pinnedAt);
        assert.deepEqual(opened.thread.sideChat, {
          lessonThreadId: LESSON_THREAD_ID,
          anchor: observationAnchor(),
          excerpt: OBSERVATION_EXCERPT,
          excerptContext: LESSON_ANCHOR_TEXT,
          label: OBSERVATION_EXCERPT,
          opening: { status: "pending", text: null, requestId: OPEN_REQUEST_ID },
          done: null,
        });
        assert.deepEqual(opened.contextTransfers, []);
        assert.deepEqual(
          (yield* orchestrator.getThreadRecords(LESSON_THREAD_ID, ["contextTransfers"]))
            .contextTransfers,
          [],
        );
        assert.deepEqual(
          (yield* outbox.listByCommandId(CommandId.make(OPEN_REQUEST_ID))).map(
            (effect) => effect.request,
          ),
          [{ type: "side-chat.opening" }],
        );

        const messageCommandId = CommandId.make("command:side-chat:first-message");
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: messageCommandId,
          threadId: SIDE_CHAT_THREAD_ID,
          messageId: MessageId.make("message:side-chat:u1"),
          text: "What goes into an observation space?",
          titleSeed: "What goes into an observation space?",
          attachments: [],
          dispatchMode: { type: "defer_start" },
          createdBy: "user",
          creationSource: "web",
        });
        assert.isFalse(
          (yield* outbox.listByCommandId(messageCommandId)).some(
            (effect) => effect.request.type === "thread-title.generate",
          ),
        );
        assert.equal((yield* readThread(SIDE_CHAT_THREAD_ID)).title, OBSERVATION_EXCERPT);

        yield* worker.drain();
        assert.equal((yield* readThread(SIDE_CHAT_THREAD_ID)).sideChat?.opening.status, "fallback");
      }).pipe(Effect.provide(openHarness())),
  );

  it.effect("opens a nested side chat under the same lesson", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sideChatReplyId = MessageId.make("message:side-chat:a1");
      const nestedThreadId = ThreadId.make("thread:side-chat:nested");
      yield* createLesson();
      yield* openOnObservation;
      yield* seedThreadMessages(SIDE_CHAT_THREAD_ID, [
        {
          id: sideChatReplyId,
          role: "assistant",
          text: "A Box space is a bounded array of numbers.",
        },
      ]);

      yield* orchestrator.dispatch(
        openSideChatCommand({
          commandId: "command:side-chat:open-nested",
          threadId: nestedThreadId,
          anchor: {
            threadId: SIDE_CHAT_THREAD_ID,
            messageId: sideChatReplyId,
            start: 2,
            end: 5,
            prefix: "A ",
            suffix: " space",
          },
          excerpt: "Box",
        }),
      );

      const nested = yield* readThread(nestedThreadId);
      assert.equal(nested.sideChat?.lessonThreadId, LESSON_THREAD_ID);
      assert.equal(nested.lineage.parentThreadId, SIDE_CHAT_THREAD_ID);
    }).pipe(Effect.provide(openHarness())),
  );

  it.effect.each([
    {
      name: "a streaming reply",
      messages: withAnchorMessage({ streaming: true }),
      messageId: LESSON_ANCHOR_MESSAGE_ID,
      excerpt: OBSERVATION_EXCERPT,
      archive: false,
      phrase: "The highlighted reply is still streaming.",
    },
    {
      name: "a user message",
      messages: LESSON_MESSAGES,
      messageId: MessageId.make("message:lesson:u1"),
      excerpt: OBSERVATION_EXCERPT,
      archive: false,
      phrase: `Message message:lesson:u1 is not an assistant reply in thread ${LESSON_THREAD_ID}.`,
    },
    {
      name: "an over-limit excerpt",
      messages: LESSON_MESSAGES,
      messageId: LESSON_ANCHOR_MESSAGE_ID,
      excerpt: "x".repeat(SIDE_CHAT_EXCERPT_MAX_CHARS + 1),
      archive: false,
      phrase: "Side chat excerpts must be 1-4000 characters.",
    },
    {
      name: "an archived lesson",
      messages: LESSON_MESSAGES,
      messageId: LESSON_ANCHOR_MESSAGE_ID,
      excerpt: OBSERVATION_EXCERPT,
      archive: true,
      phrase: `Thread ${LESSON_THREAD_ID} is not active.`,
    },
  ])("refuses to open a side chat on $name", ({ messages, messageId, excerpt, archive, phrase }) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* createLesson({ messages });
      if (archive) {
        yield* orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("command:side-chat:archive-lesson"),
          threadId: LESSON_THREAD_ID,
        });
      }

      const error = yield* orchestrator
        .dispatch(
          openSideChatCommand({
            commandId: OPEN_REQUEST_ID,
            threadId: SIDE_CHAT_THREAD_ID,
            anchor: observationAnchor(LESSON_THREAD_ID, messageId),
            excerpt,
          }),
        )
        .pipe(Effect.flip);

      assert.equal(error._tag, "OrchestratorDispatchError");
      assert.include(String(error.cause), phrase);
      assert.isNull(yield* orchestrator.getThreadShell(SIDE_CHAT_THREAD_ID));
    }).pipe(Effect.provide(openHarness())),
  );

  const INTERRUPTED_RUN_ID = RunId.make("run:lesson:interrupted");

  /** The highlighted reply came from a run the user interrupted. */
  const seedInterruptedAnchorRun = Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    yield* createLesson({ messages: withAnchorMessage({ runId: INTERRUPTED_RUN_ID }) });
    const now = yield* DateTime.now;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("event:lesson:interrupted-run"),
          type: "run.updated",
          threadId: LESSON_THREAD_ID,
          runId: INTERRUPTED_RUN_ID,
          occurredAt: now,
          payload: {
            id: INTERRUPTED_RUN_ID,
            threadId: LESSON_THREAD_ID,
            ordinal: 1,
            providerInstanceId: LESSON_SELECTION.instanceId,
            modelSelection: LESSON_SELECTION,
            providerThreadId: null,
            userMessageId: MessageId.make("message:lesson:u1"),
            rootNodeId: null,
            activeAttemptId: null,
            status: "interrupted",
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
      ],
    });
  });

  /** A newer lesson reply is still streaming below the highlighted one. */
  const seedStreamingLaterReply = createLesson({
    messages: [
      ...LESSON_MESSAGES,
      {
        id: MessageId.make("message:lesson:a3"),
        role: "assistant",
        text: "LESSON-ONLY: discount factors weigh later rewards",
        streaming: true,
      },
    ],
  });

  it.effect.each([
    { name: "a reply whose run was interrupted", seed: seedInterruptedAnchorRun },
    { name: "an earlier reply while a newer lesson reply streams", seed: seedStreamingLaterReply },
  ])("opens a side chat from $name", ({ seed }) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* seed;

      yield* openOnObservation;

      assert.isNotNull(yield* orchestrator.getThreadShell(SIDE_CHAT_THREAD_ID));
      assert.equal((yield* readThread(SIDE_CHAT_THREAD_ID)).sideChat?.opening.status, "pending");
    }).pipe(Effect.provide(openHarness())),
  );
});
