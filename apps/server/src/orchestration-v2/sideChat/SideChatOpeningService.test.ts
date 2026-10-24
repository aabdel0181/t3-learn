import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, vi } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  TextGenerationError,
  type OrchestrationV2SideChatAnchor,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
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
) =>
  Effect.gen(function* () {
    yield* createLesson();
    return yield* seedSideChatThread({
      threadId: SIDE_CHAT_THREAD_ID,
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

const executeOpening = (requestId: string) =>
  Effect.gen(function* () {
    const opening = yield* SideChatOpening.SideChatOpeningService;
    yield* opening.execute({
      threadId: SIDE_CHAT_THREAD_ID,
      requestId: CommandId.make(requestId),
    });
  });

const readSideChatThread = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const { thread } = yield* threads.getThreadRecords(SIDE_CHAT_THREAD_ID, []);
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
      assert.deepEqual((yield* readSideChatThread).sideChat?.opening, {
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
      const thread = yield* readSideChatThread;
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
      assert.include(
        request?.prompt,
        `ASSISTANT (the reply the learner highlighted):\n${LESSON_ANCHOR_TEXT}`,
      );
      assert.include(request?.prompt, LESSON_TOPIC);
      assert.include(request?.cwd, "t3code-side-chat-");
      assert.deepEqual(request?.modelSelection, settings.textGenerationModelSelection);
      assert.deepEqual((yield* readSideChatThread).sideChat?.opening, {
        status: "ready",
        text: "Summary of the RL lesson",
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("records a failed summary instead of failing the effect", () =>
    Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);

      yield* executeOpening(OPEN_REQUEST_ID);

      assert.deepEqual((yield* readSideChatThread).sideChat?.opening, {
        status: "failed",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(
      Effect.provide(
        makeHarness({
          generateSideChatText: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "generateSideChatText",
                detail: "model unavailable",
              }),
            ),
        }).layer,
      ),
    ),
  );

  it.effect("falls back when the model has nothing to summarize", () =>
    Effect.gen(function* () {
      yield* seedPending(OPEN_REQUEST_ID);

      yield* executeOpening(OPEN_REQUEST_ID);

      assert.deepEqual((yield* readSideChatThread).sideChat?.opening, {
        status: "fallback",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(
      Effect.provide(
        makeHarness({ generateSideChatText: () => Effect.succeed({ text: null }) }).layer,
      ),
    ),
  );

  it.effect("falls back when the highlighted reply is gone", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seedPending(
        OPEN_REQUEST_ID,
        observationAnchor(LESSON_THREAD_ID, MessageId.make("message:lesson:rolled-back")),
      );

      yield* executeOpening(OPEN_REQUEST_ID);

      assert.deepEqual((yield* readSideChatThread).sideChat?.opening, {
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
      assert.deepEqual((yield* readSideChatThread).sideChat?.opening, {
        status: "pending",
        text: null,
        requestId: OPEN_REQUEST_ID,
      });
    }).pipe(Effect.provide(harness.layer));
  });
});
