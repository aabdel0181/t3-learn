import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../Orchestrator.ts";
import { makeSideChatHarness } from "./SideChatHarness.ts";

describe("side chat Done", () => {
  it.effect("opens a side chat on a highlight in the lesson's reply", () =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness("side-chat-harness");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const lesson = yield* harness.createLesson("Teach me RL environments.");

        const space = yield* harness.openSideChat({
          parentThreadId: lesson,
          label: "observation space",
        });

        const shell = yield* orchestrator.getThreadShell(space);
        assert.equal(shell?.sideChat?.label, "observation space");
        assert.equal(shell?.sideChat?.lessonThreadId, lesson);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );
});
