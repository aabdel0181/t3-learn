import { assert, describe, it } from "@effect/vitest";
import { CommandId, ProviderDriverKind } from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { CodexProviderCapabilitiesV2 } from "../Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../CommandReceiptStore.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../ThreadManagementService.ts";
import * as ProviderReplayHarness from "../testkit/ProviderReplayHarness.ts";
import {
  createLesson,
  LESSON_SELECTION,
  LESSON_THREAD_ID,
  observationAnchor,
  pendingSideChat,
  seedSideChatThread,
  SIDE_CHAT_THREAD_ID,
} from "../testkit/sideChatFixtures.ts";

const adapter = {
  instanceId: LESSON_SELECTION.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in side chat opening tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

function makeHarness() {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerRegistry = ProviderAdapterRegistry.layerFromAdapters([adapter]);
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "side-chat-opening" },
    layerRegistry,
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(ServerSettings.layerTest({})),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  return { layer: Layer.mergeAll(layerOrchestrator, layerThreadManagement) };
}

const OPEN_REQUEST_ID = "command:side-chat:open";

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

const readSideChatThread = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const { thread } = yield* threads.getThreadRecords(SIDE_CHAT_THREAD_ID, []);
  return thread;
});

describe("thread.side_chat.opening.complete", () => {
  it.effect("lands only the completion for the pending request", () =>
    Effect.gen(function* () {
      yield* createLesson();
      const seeded = yield* seedSideChatThread({
        threadId: SIDE_CHAT_THREAD_ID,
        anchorThreadId: LESSON_THREAD_ID,
        sideChat: pendingSideChat({
          anchor: observationAnchor(),
          excerpt: "observation space",
          requestId: OPEN_REQUEST_ID,
        }),
      });
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
