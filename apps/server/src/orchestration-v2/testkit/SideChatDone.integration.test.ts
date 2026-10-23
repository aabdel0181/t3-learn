import { CommandId, MessageId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../Orchestrator.ts";
import { SIDE_CHAT_OUTCOME_EXCERPT_HEADER } from "../sideChat/notes.ts";
import { makeSideChatHarness, SIDE_CHAT_HARNESS_REPLY } from "./SideChatHarness.ts";

const SPACE = "observation space";
const SPACE_QUESTION = "What is an observation space?";

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

  it.effect("Done writes a short note for a side chat with messages", () =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness("side-chat-done-note");
      yield* Effect.gen(function* () {
        const lesson = yield* harness.createLesson("Teach me RL environments.");
        const space = yield* harness.openSideChat({ parentThreadId: lesson, label: SPACE });
        yield* harness.send(space, SPACE_QUESTION);
        harness.scriptNote(SPACE, { text: "  The learner had not met\nobservation spaces. " });

        const after = yield* harness.mark;
        yield* harness.finish(space);
        const finished = yield* harness.awaitOutcome(after, space, "ready");

        assert.equal(
          finished.sideChat?.done?.outcome.note,
          "The learner had not met observation spaces.",
        );
        const input = harness.outcomeInputFor(SPACE) ?? "";
        const header = `${SIDE_CHAT_OUTCOME_EXCERPT_HEADER}\n${SPACE}\n`;
        assert.equal(input.slice(0, header.length), header);
        assert.include(input, `User: ${SPACE_QUESTION}`);
        assert.include(input, `Assistant: ${SIDE_CHAT_HARNESS_REPLY}`);
        // R6: nothing of the side chat reached the lesson's provider.
        assert.lengthOf(harness.prompts(lesson), 1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    { script: { text: null }, status: "none", error: undefined },
    { script: { fail: "model unavailable" }, status: "failed", error: "model unavailable" },
  ] as const)("Done records a $status outcome without a note", ({ script, status, error }) =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness(`side-chat-done-${status}`);
      yield* Effect.gen(function* () {
        const lesson = yield* harness.createLesson("Teach me RL environments.");
        const space = yield* harness.openSideChat({ parentThreadId: lesson, label: SPACE });
        yield* harness.send(space, SPACE_QUESTION);
        harness.scriptNote(SPACE, script);

        const after = yield* harness.mark;
        yield* harness.finish(space);
        const finished = yield* harness.awaitOutcome(after, space, status);

        assert.isDefined(harness.outcomeInputFor(SPACE));
        assert.isNull(finished.sideChat?.done?.outcome.note);
        assert.equal(finished.sideChat?.done?.outcome.error, error);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect("Done deletes a side chat nobody wrote in", () =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness("side-chat-done-empty");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const lesson = yield* harness.createLesson("Teach me RL environments.");
        const space = yield* harness.openSideChat({ parentThreadId: lesson, label: SPACE });

        yield* harness.finish(space);

        assert.isNull(yield* orchestrator.getThreadShell(space));
        assert.deepEqual(harness.outcomeInputs(), []);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect("Discard deletes the side chat and its nested side chats without writing a note", () =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness("side-chat-done-discard");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const lesson = yield* harness.createLesson("Teach me RL environments.");
        const space = yield* harness.openSideChat({ parentThreadId: lesson, label: SPACE });
        yield* harness.send(space, SPACE_QUESTION);
        const box = yield* harness.openSideChat({ parentThreadId: space, label: "Box" });

        yield* harness.finish(space, { discard: true });

        assert.isNull(yield* orchestrator.getThreadShell(space));
        assert.isNull(yield* orchestrator.getThreadShell(box));
        assert.deepEqual(harness.outcomeInputs(), []);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "a stale outcome completion is dropped and pressing Done twice keeps the first outcome",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSideChatHarness("side-chat-done-stale");
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const lesson = yield* harness.createLesson("Teach me RL environments.");
          const space = yield* harness.openSideChat({ parentThreadId: lesson, label: SPACE });
          yield* harness.send(space, SPACE_QUESTION);
          const gate = yield* Deferred.make<string | null>();
          harness.scriptNote(SPACE, { gate });

          const after = yield* harness.mark;
          yield* harness.finish(space);
          yield* harness.noteRequested(SPACE);
          yield* orchestrator.dispatch({
            type: "thread.side_chat.outcome.complete",
            commandId: CommandId.make("outcome-complete:stale"),
            threadId: space,
            requestId: "stale-request",
            status: "ready",
            note: "Stale note.",
          });
          assert.equal((yield* harness.thread(space)).sideChat?.done?.outcome.status, "generating");

          yield* Deferred.succeed(gate, "Real note.");
          const finished = yield* harness.awaitOutcome(after, space, "ready");
          assert.equal(finished.sideChat?.done?.outcome.note, "Real note.");

          yield* harness.finish(space);
          assert.deepEqual((yield* harness.thread(space)).sideChat?.done, finished.sideChat?.done);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("a note that lands after Discard leaves the deleted side chat as it was", () =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness("side-chat-done-discard-late");
      yield* Effect.gen(function* () {
        const lesson = yield* harness.createLesson("Teach me RL environments.");
        const space = yield* harness.openSideChat({ parentThreadId: lesson, label: SPACE });
        yield* harness.send(space, SPACE_QUESTION);
        const gate = yield* Deferred.make<string | null>();
        harness.scriptNote(SPACE, { gate });
        yield* harness.finish(space);
        yield* harness.noteRequested(SPACE);
        yield* harness.finish(space, { discard: true });

        const after = yield* harness.mark;
        yield* Deferred.succeed(gate, "Late note.");
        const landed = yield* harness.awaitEvent(
          after,
          (event) => event.type === "thread.metadata-updated" && event.threadId === space,
        );

        assert(landed.type === "thread.metadata-updated");
        assert.isNotNull(landed.payload.deletedAt);
        assert.equal(landed.payload.sideChat?.done?.outcome.status, "generating");
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect("Done refuses a thread that is not a side chat", () =>
    Effect.gen(function* () {
      const harness = yield* makeSideChatHarness("side-chat-done-lesson");
      yield* Effect.gen(function* () {
        const lesson = yield* harness.createLesson("Teach me RL environments.");

        const error = yield* harness.finish(lesson).pipe(Effect.flip);

        assert.equal(error._tag, "OrchestratorDispatchError");
        assert.include(String(error.cause), `Thread ${lesson} is not a side chat.`);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "an open that reuses its lesson's id is refused rather than locking the lesson twice",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSideChatHarness("side-chat-done-open-lesson-id");
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const lesson = yield* harness.createLesson("Teach me RL environments.");

          const error = yield* orchestrator
            .dispatch({
              type: "thread.side_chat.open",
              commandId: CommandId.make("open:lesson-id"),
              threadId: lesson,
              anchorThreadId: lesson,
              anchor: {
                threadId: lesson,
                messageId: MessageId.make("message:lesson-id"),
                start: 0,
                end: SPACE.length,
                prefix: "",
                suffix: "",
              },
              excerpt: SPACE,
              createdBy: "user",
              creationSource: "web",
            })
            .pipe(Effect.flip);

          assert.equal(error._tag, "OrchestratorThreadAlreadyExistsError");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );
});
