import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProviderDriverKind,
  RunId,
  SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
  SIDE_CHAT_EXCERPT_MAX_CHARS,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { ClaudeProviderCapabilitiesV2 } from "../Adapters/ClaudeAdapterV2.ts";
import { CodexProviderCapabilitiesV2 } from "../Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../EffectOutbox.ts";
import * as EffectWorker from "../EffectWorker.ts";
import * as EventSink from "../EventSink.ts";
import * as Orchestrator from "../Orchestrator.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import { SIDE_CHAT_OPENING_FRAMING } from "../sideChat/sideChatText.ts";
import { makePromptRecordingAdapter } from "./PromptRecordingAdapter.ts";
import * as ProviderReplayHarness from "./ProviderReplayHarness.ts";
import {
  CLAUDE_SELECTION,
  completeLatestRun,
  createLesson,
  LESSON_ANCHOR_MESSAGE_ID,
  LESSON_ANCHOR_TEXT,
  LESSON_MESSAGES,
  LESSON_SELECTION,
  LESSON_SUMMARY,
  LESSON_THREAD_ID,
  LESSON_TOPIC,
  OBSERVATION_PARAGRAPH,
  observationAnchor,
  openSideChatCommand,
  OTHER_ASSISTANT_REPLY,
  OTHER_USER_MESSAGE,
  type SeedMessage,
  seedThreadMessages,
  SIDE_CHAT_THREAD_ID,
  sideChatMessageCommand,
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

describe("side chat opening context", () => {
  type GenerateSideChatText = TextGeneration.TextGeneration["Service"]["generateSideChatText"];

  /** A recording Codex adapter for the lesson and its side chats, and a Claude one to switch to. */
  const deliveryHarness = Effect.fn("deliveryHarness")(function* (
    name: string,
    options: {
      readonly generateSideChatText?: GenerateSideChatText;
      readonly failResume?: boolean;
      readonly onOpenSession?: Effect.Effect<void>;
    } = {},
  ) {
    const cwd = yield* checkpointWorkspace(name);
    const lesson = yield* makePromptRecordingAdapter({
      instanceId: LESSON_SELECTION.instanceId,
      driver: ProviderDriverKind.make("codex"),
      capabilities: CodexProviderCapabilitiesV2,
      cwd,
      ...(options.failResume === undefined ? {} : { failResume: options.failResume }),
      ...(options.onOpenSession === undefined ? {} : { onOpenSession: options.onOpenSession }),
    });
    const switched = yield* makePromptRecordingAdapter({
      instanceId: CLAUDE_SELECTION.instanceId,
      driver: ProviderDriverKind.make("claudeAgent"),
      capabilities: ClaudeProviderCapabilitiesV2,
      cwd,
    });
    const layer = ProviderReplayHarness.layerWithRegistry(
      { name },
      ProviderAdapterRegistry.layerFromAdapters([lesson.adapter, switched.adapter]),
      {
        runEffectWorker: false,
        sideChatTextGeneration:
          options.generateSideChatText ?? (() => Effect.succeed({ text: LESSON_SUMMARY })),
      },
    );
    return { cwd, layer, prompts: lesson.prompts, switchPrompts: switched.prompts };
  });

  const ask = (threadId: ThreadId, commandId: string, text: string) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* orchestrator.dispatch(sideChatMessageCommand({ commandId, threadId, text }));
      yield* worker.drain();
    });

  /** Opens a side chat on "observation space", lets its summary land, then asks in it. */
  const openAndAsk = (cwd: string) =>
    Effect.gen(function* () {
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* createLesson({ worktreePath: cwd });
      yield* openOnObservation;
      yield* worker.drain();
      yield* ask(SIDE_CHAT_THREAD_ID, "command:side-chat:ask", "What is an observation space?");
    });

  const promptsFor = (
    prompts: ReadonlyArray<{ threadId: ThreadId; text: string }>,
    threadId: ThreadId,
  ) => prompts.filter((prompt) => prompt.threadId === threadId).map((prompt) => prompt.text);

  it.effect(
    "gives the first turn the framing, summary and highlight and no other lesson messages",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { cwd, layer, prompts } = yield* deliveryHarness("side-chat-opening-ready");
          yield* Effect.gen(function* () {
            const orchestrator = yield* Orchestrator.OrchestratorV2;
            yield* openAndAsk(cwd);

            const [prompt] = promptsFor(prompts, SIDE_CHAT_THREAD_ID);
            assert.isDefined(prompt);
            assert.include(prompt, SIDE_CHAT_OPENING_FRAMING);
            assert.include(prompt, LESSON_SUMMARY);
            assert.include(prompt, OBSERVATION_PARAGRAPH);
            assert.include(prompt, "User message:\nWhat is an observation space?");
            assert.notInclude(prompt, LESSON_TOPIC);
            assert.notInclude(prompt, OTHER_USER_MESSAGE);
            assert.notInclude(prompt, OTHER_ASSISTANT_REPLY);

            const projection = yield* orchestrator.getThreadProjection(SIDE_CHAT_THREAD_ID);
            assert.deepEqual(
              projection.turnItems.flatMap((item) =>
                item.type === "handoff" && item.title === SIDE_CHAT_CONTEXT_HANDOFF_TITLE
                  ? [item.strategy]
                  : [],
              ),
              ["manual_context"],
            );
            assert.deepEqual(projection.contextTransfers, []);
          }).pipe(Effect.provide(layer));
        }),
      ),
  );

  it.effect(
    "falls back to the lesson topic and the highlight's surroundings when the summary failed",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { cwd, layer, prompts } = yield* deliveryHarness("side-chat-opening-failed", {
            generateSideChatText: () =>
              Effect.fail(
                new TextGenerationError({
                  operation: "generateSideChatText",
                  detail: "The model is unavailable.",
                }),
              ),
          });
          yield* openAndAsk(cwd).pipe(Effect.provide(layer));

          const [prompt] = promptsFor(prompts, SIDE_CHAT_THREAD_ID);
          assert.isDefined(prompt);
          assert.include(prompt, "The lesson summary is unavailable.");
          assert.include(prompt, LESSON_TOPIC);
          assert.include(prompt, OBSERVATION_PARAGRAPH);
          assert.notInclude(prompt, OTHER_USER_MESSAGE);
          assert.notInclude(prompt, OTHER_ASSISTANT_REPLY);
        }),
      ),
  );

  it.effect("carries the parent side chat's summary into a nested side chat", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { cwd, layer, prompts } = yield* deliveryHarness("side-chat-opening-nested", {
          generateSideChatText: (input) =>
            Effect.succeed({
              text: input.prompt.includes("Box space") ? "NESTED SUMMARY" : LESSON_SUMMARY,
            }),
        });
        const nestedThreadId = ThreadId.make("thread:side-chat:nested");
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const sideChatReplyId = MessageId.make("message:side-chat:a1");
          yield* openAndAsk(cwd);
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
          yield* worker.drain();
          yield* ask(nestedThreadId, "command:side-chat:ask-nested", "What is a Box?");
        }).pipe(Effect.provide(layer));

        const [prompt] = promptsFor(prompts, nestedThreadId);
        assert.isDefined(prompt);
        assert.include(prompt, "NESTED SUMMARY");
        assert.include(
          prompt,
          `Context from the side chat this one was opened from:\n${LESSON_SUMMARY}`,
        );
      }),
    ),
  );

  it.effect("gives the opening context again after a provider switch inside the side chat", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { cwd, layer, switchPrompts } = yield* deliveryHarness("side-chat-opening-switch");
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          yield* openAndAsk(cwd);
          yield* completeLatestRun(SIDE_CHAT_THREAD_ID);
          yield* orchestrator.dispatch(
            sideChatMessageCommand({
              commandId: "command:side-chat:ask-claude",
              threadId: SIDE_CHAT_THREAD_ID,
              text: "And what does the agent do with it?",
              modelSelection: CLAUDE_SELECTION,
            }),
          );
          yield* worker.drain();
        }).pipe(Effect.provide(layer));

        const [prompt] = promptsFor(switchPrompts, SIDE_CHAT_THREAD_ID);
        assert.isDefined(prompt);
        assert.include(prompt, SIDE_CHAT_OPENING_FRAMING);
        assert.include(prompt, LESSON_SUMMARY);
      }),
    ),
  );
});
