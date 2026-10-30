import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, vi } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  TextGenerationError,
  type OrchestrationV2SideChatAnchor,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "../Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../CommandReceiptStore.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../ThreadManagementService.ts";
import * as ProviderReplayHarness from "../testkit/ProviderReplayHarness.ts";
import {
  createLesson,
  LESSON_ANCHOR_TEXT,
  LESSON_SELECTION,
  LESSON_THREAD_ID,
  LESSON_TOPIC,
  observationAnchor,
  pendingSideChat,
  seedSideChatThread,
  seedThreadMessages,
  SIDE_CHAT_THREAD_ID,
} from "../testkit/sideChatFixtures.ts";
import * as SideChatOpening from "./SideChatOpeningService.ts";

const adapter = {
  instanceId: LESSON_SELECTION.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in side chat opening tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

type GenerateSideChatText = TextGeneration.TextGeneration["Service"]["generateSideChatText"];

function makeHarness(options: { readonly generateSideChatText?: GenerateSideChatText } = {}) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerRegistry = ProviderAdapterRegistry.layerFromAdapters([adapter]);
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "side-chat-opening" },
    layerRegistry,
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest({});
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  const generateSideChatText = vi.fn<GenerateSideChatText>(
    options.generateSideChatText ?? (() => Effect.succeed({ text: "Summary of the RL lesson" })),
  );
  // Fresh: the harness's effect executor already built this layer over its own default fake.
  const layerSideChatOpening = Layer.fresh(SideChatOpening.layer).pipe(
    Layer.provide(
      Layer.mergeAll(
        layerThreadManagement,
        layerServerSettings,
        Layer.mock(TextGeneration.TextGeneration)({ generateSideChatText }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
        NodeServices.layer,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(
      layerOrchestrator,
      layerThreadManagement,
      layerServerSettings,
      layerSideChatOpening,
    ),
    generateSideChatText,
  };
}

const OPEN_REQUEST_ID = "command:side-chat:open";

/** The lesson, and a side chat on "observation space" whose opening summary is pending. */
const seedPending = (
  requestId: string,
  anchor: OrchestrationV2SideChatAnchor = observationAnchor(),
  options: { readonly createLesson?: boolean; readonly threadId?: ThreadId } = {},
) =>
  Effect.gen(function* () {
    if (options.createLesson ?? true) yield* createLesson();
    return yield* seedSideChatThread({
      threadId: options.threadId ?? SIDE_CHAT_THREAD_ID,
      anchorThreadId: LESSON_THREAD_ID,
      sideChat: pendingSideChat({ anchor, excerpt: "observation space", requestId }),
    });
  });

function completeOpening(input: {
  readonly command: string;
  readonly requestId: string;
  readonly status: "ready" | "fallback" | "failed";
  readonly text: string | null;
}) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    return yield* threads.dispatch({
      type: "thread.side_chat.opening.complete",
      commandId: CommandId.make(input.command),
      threadId: SIDE_CHAT_THREAD_ID,
      requestId: input.requestId,
      status: input.status,
      text: input.text,
    });
  });
}

const executeOpening = (requestId: string, threadId: ThreadId = SIDE_CHAT_THREAD_ID) =>
  Effect.gen(function* () {
    const opening = yield* SideChatOpening.SideChatOpeningService;
    yield* opening.execute({
      threadId,
      requestId: CommandId.make(requestId),
    });
  });

const readSideChatThread = (threadId: ThreadId = SIDE_CHAT_THREAD_ID) =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const { thread } = yield* threads.getThreadRecords(threadId, []);
    return thread;
  });

describe("thread.side_chat.opening.complete", () => {
  it.effect("lands only the completion for the pending request", () =>
    Effect.gen(function* () {
      const seeded = yield* seedPending(OPEN_REQUEST_ID);
      // Any completion that bumped activity would now move updatedAt.
      yield* TestClock.adjust("1 minute");

      const stale = yield* completeOpening({
        command: "command:side-chat:opening:stale",
        requestId: "command:side-chat:stale",
        status: "ready",
        text: "Stale summary",
      });
      assert.deepEqual(
        stale.storedEvents.map((stored) => stored.event.type),
        ["thread.metadata-updated"],
      );
      assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
        status: "pending",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });

      yield* completeOpening({
        command: "command:side-chat:opening:ready",
        requestId: OPEN_REQUEST_ID,
        status: "ready",
        text: "Summary of the RL lesson",
      });
      yield* completeOpening({
        command: "command:side-chat:opening:late",
        requestId: OPEN_REQUEST_ID,
        status: "failed",
        text: null,
      });
      const thread = yield* readSideChatThread();
      assert.deepEqual(thread.sideChat?.opening, {
        status: "ready",
        text: "Summary of the RL lesson",
        requestId: OPEN_REQUEST_ID,
      });
      assert.deepEqual(thread.updatedAt, seeded.updatedAt);
    }).pipe(Effect.provide(makeHarness().layer)),
  );
});

describe("SideChatOpeningService", () => {
  it.effect("summarizes the lesson around the highlight from an empty directory", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);

      yield* executeOpening(OPEN_REQUEST_ID);

      const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
      assert.equal(harness.generateSideChatText.mock.calls.length, 1);
      const request = harness.generateSideChatText.mock.calls[0]?.[0];
      assert.equal(request?.kind, "opening_summary");
      assert.include(request?.prompt, `ASSISTANT:\n${LESSON_ANCHOR_TEXT}`);
      assert.include(request?.prompt, LESSON_TOPIC);
      assert.include(request?.cwd, "t3code-side-chat-");
      assert.deepEqual(request?.modelSelection, settings.textGenerationModelSelection);
      assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
        status: "ready",
        text: "Summary of the RL lesson",
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("shares a ready summary for side chats opened from the same lesson state", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);
      const secondThreadId = ThreadId.make("thread:side-chat:second");
      const secondRequestId = "command:side-chat:second";
      yield* seedPending(
        secondRequestId,
        observationAnchor(LESSON_THREAD_ID, MessageId.make("message:lesson:a2")),
        { createLesson: false, threadId: secondThreadId },
      );

      yield* executeOpening(OPEN_REQUEST_ID);
      yield* executeOpening(secondRequestId, secondThreadId);

      assert.equal(harness.generateSideChatText.mock.calls.length, 1);
      assert.deepEqual(
        (yield* readSideChatThread()).sideChat?.opening.text,
        "Summary of the RL lesson",
      );
      assert.deepEqual(
        (yield* readSideChatThread(secondThreadId)).sideChat?.opening.text,
        "Summary of the RL lesson",
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not reuse a summary after the lesson changes", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);
      yield* executeOpening(OPEN_REQUEST_ID);
      yield* seedThreadMessages(LESSON_THREAD_ID, [
        { id: MessageId.make("message:lesson:new"), role: "user", text: "A new question" },
      ]);
      const secondThreadId = ThreadId.make("thread:side-chat:changed");
      const secondRequestId = "command:side-chat:changed";
      yield* seedPending(secondRequestId, observationAnchor(), {
        createLesson: false,
        threadId: secondThreadId,
      });
      yield* executeOpening(secondRequestId, secondThreadId);
      assert.equal(harness.generateSideChatText.mock.calls.length, 2);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("coalesces summaries while the first write is in flight", () => {
    return Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const sharedText = "Summary of the RL lesson";
      const harness = makeHarness({
        generateSideChatText: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            return { text: sharedText };
          }),
      });
      yield* Effect.gen(function* () {
        yield* seedPending(OPEN_REQUEST_ID);
        const secondThreadId = ThreadId.make("thread:side-chat:in-flight");
        const secondRequestId = "command:side-chat:in-flight";
        yield* seedPending(secondRequestId, observationAnchor(), {
          createLesson: false,
          threadId: secondThreadId,
        });
        const first = yield* executeOpening(OPEN_REQUEST_ID).pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        const second = yield* executeOpening(secondRequestId, secondThreadId).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        assert.equal(harness.generateSideChatText.mock.calls.length, 1);
        assert.deepEqual((yield* readSideChatThread(secondThreadId)).sideChat?.opening, {
          status: "pending",
          text: null,
          requestId: secondRequestId,
        });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        assert.equal(harness.generateSideChatText.mock.calls.length, 1);
        assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
          status: "ready",
          text: sharedText,
          requestId: OPEN_REQUEST_ID,
        });
        assert.deepEqual((yield* readSideChatThread(secondThreadId)).sideChat?.opening, {
          status: "ready",
          text: sharedText,
          requestId: secondRequestId,
        });
      }).pipe(Effect.provide(harness.layer));
    });
  });

  it.effect("does not share a fallback result with an in-flight waiter", () => {
    return Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let calls = 0;
      const harness = makeHarness({
        generateSideChatText: () => {
          calls += 1;
          return calls === 1
            ? Effect.succeed(undefined).pipe(
                Effect.tap(() => Deferred.succeed(entered, undefined)),
                Effect.andThen(Deferred.await(release)),
                Effect.as({ text: null }),
              )
            : Effect.succeed({ text: "RETRY SUMMARY" });
        },
      });
      yield* Effect.gen(function* () {
        yield* seedPending(OPEN_REQUEST_ID);
        const secondThreadId = ThreadId.make("thread:side-chat:fallback-waiter");
        const secondRequestId = "command:side-chat:fallback-waiter";
        yield* seedPending(secondRequestId, observationAnchor(), {
          createLesson: false,
          threadId: secondThreadId,
        });
        const first = yield* executeOpening(OPEN_REQUEST_ID).pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        const second = yield* executeOpening(secondRequestId, secondThreadId).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        assert.equal(calls, 1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        assert.equal(calls, 2);
        assert.deepEqual((yield* readSideChatThread()).sideChat?.opening.status, "fallback");
        assert.deepEqual((yield* readSideChatThread(secondThreadId)).sideChat?.opening, {
          status: "ready",
          text: "RETRY SUMMARY",
          requestId: secondRequestId,
        });
      }).pipe(Effect.provide(harness.layer));
    });
  });

  it.effect("records a failed summary instead of failing the effect", () => {
    const harness = makeHarness({
      generateSideChatText: () =>
        Effect.fail(
          new TextGenerationError({
            operation: "generateSideChatText",
            detail: "model unavailable",
          }),
        ),
    });
    return Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);

      yield* executeOpening(OPEN_REQUEST_ID);

      const secondThreadId = ThreadId.make("thread:side-chat:failed-again");
      yield* seedPending("command:side-chat:failed-again", observationAnchor(), {
        createLesson: false,
        threadId: secondThreadId,
      });
      yield* executeOpening("command:side-chat:failed-again", secondThreadId);
      assert.equal(harness.generateSideChatText.mock.calls.length, 2);

      assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
        status: "failed",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not cache a fallback result", () => {
    const harness = makeHarness({ generateSideChatText: () => Effect.succeed({ text: null }) });
    return Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);

      yield* executeOpening(OPEN_REQUEST_ID);

      const secondThreadId = ThreadId.make("thread:side-chat:fallback-again");
      const secondRequestId = "command:side-chat:fallback-again";
      yield* seedPending(secondRequestId, observationAnchor(), {
        createLesson: false,
        threadId: secondThreadId,
      });
      yield* executeOpening(secondRequestId, secondThreadId);
      assert.equal(harness.generateSideChatText.mock.calls.length, 2);

      assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
        status: "fallback",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("falls back when the highlighted reply is gone", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seedPending(
        OPEN_REQUEST_ID,
        observationAnchor(LESSON_THREAD_ID, MessageId.make("message:lesson:rolled-back")),
      );

      yield* executeOpening(OPEN_REQUEST_ID);

      assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
        status: "fallback",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
      assert.equal(harness.generateSideChatText.mock.calls.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("skips a request that is no longer the pending one", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);

      yield* executeOpening("command:side-chat:older");

      assert.equal(harness.generateSideChatText.mock.calls.length, 0);
      assert.deepEqual((yield* readSideChatThread()).sideChat?.opening, {
        status: "pending",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(Effect.provide(harness.layer));
  });
});
