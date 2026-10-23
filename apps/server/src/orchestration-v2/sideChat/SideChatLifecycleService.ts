import {
  CommandId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type RunId,
  SIDE_CHAT_WAIT_CAP_MS,
  TextGenerationError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import type * as ServerSettings from "../../serverSettings.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as EventSink from "../EventSink.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import type * as ProjectStore from "../ProjectStore.ts";
import * as ThreadManagementService from "../ThreadManagementService.ts";
import {
  buildSideChatOutcomeInput,
  isUserAuthoredSideChatTrigger,
  normalizeSideChatNote,
} from "./notes.ts";
import {
  sideChatChildren,
  sideChatLessonThreadId,
  undeliveredGeneratingSideChats,
  undeliveredReadySideChatNotes,
} from "./tree.ts";
import { makeWriteSideChatText } from "./writeSideChatText.ts";

export class SideChatLifecycleService extends Context.Service<
  SideChatLifecycleService,
  {
    /**
     * Writes the note for the side chat's `generating` outcome `requestId` and lands it with
     * `thread.side_chat.outcome.complete`. Never fails: interrupts propagate, and anything else is
     * logged and recorded as `failed`, because a failed outbox row pins the lesson's worktree.
     */
    readonly writeOutcome: (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
    }) => Effect.Effect<void>;
    /**
     * Runs before every provider turn starts. When the run's message is the user's own and the
     * thread's side chats have notes it has not received, it waits for notes still being written
     * (until `SIDE_CHAT_WAIT_CAP_MS` after the message was sent), then attaches the ready ones with
     * `thread.side_chat.notes.attach`. Never fails: interrupts propagate, and anything else is
     * logged and the turn starts without the notes.
     */
    readonly awaitNotesForRunStart: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/sideChat/SideChatLifecycleService") {}

type OutcomeResult =
  | { readonly status: "ready"; readonly note: string }
  | { readonly status: "none"; readonly note: null }
  | { readonly status: "failed"; readonly note: null; readonly error: string };

type TranscriptMessage = OrchestrationV2ConversationMessage & {
  readonly role: "user" | "assistant";
};

const isTextGenerationError = Schema.is(TextGenerationError);

/** Whether `event` ends a wait for a side chat's note: it was deleted, or stopped generating. */
const settlesSideChatNote = (event: OrchestrationV2DomainEvent): boolean =>
  event.type === "thread.deleted" ||
  (event.type === "thread.metadata-updated" &&
    event.payload.sideChat?.done?.outcome.status !== "generating");

/** The text generation's own explanation when it failed, otherwise a generic one. */
const failureDetail = (cause: Cause.Cause<unknown>): string =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => "Couldn't write the note.",
    onSome: (error) => (isTextGenerationError(error) ? error.detail : "Couldn't write the note."),
  });

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const writeSideChatText = yield* makeWriteSideChatText;

  /**
   * Waits until every side chat in `threadIds` is deleted or its note stops generating, reading
   * their events after `afterSequence`, but not past `deadline`. A failed read ends the wait.
   */
  const awaitSideChatNotes = Effect.fn("SideChatLifecycleService.awaitSideChatNotes")(
    function* (threadIds: ReadonlyArray<ThreadId>, afterSequence: number, deadline: DateTime.Utc) {
      const remainingMillis =
        DateTime.toEpochMillis(deadline) - DateTime.toEpochMillis(yield* DateTime.now);
      if (threadIds.length === 0 || remainingMillis <= 0) return;
      yield* Effect.forEach(
        threadIds,
        (threadId) =>
          eventSink.stream({ threadId, afterSequence }).pipe(
            Stream.filter((stored) => settlesSideChatNote(stored.event)),
            Stream.runHead,
          ),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.timeoutOption(remainingMillis));
    },
    (effect, threadIds) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("Side-chat notes wait failed", { threadIds, error }),
        ),
      ),
  );

  const awaitNotesForRunStart: SideChatLifecycleService["Service"]["awaitNotesForRunStart"] =
    Effect.fn("SideChatLifecycleService.awaitNotesForRunStart")(
      function* (input) {
        // Every provider turn passes through here, so the cheap checks come first.
        const { thread, runs, messages } = yield* projections.getThreadRecords(
          input.threadId,
          ["runs", "messages"],
          { runIds: [input.runId], messageRunIds: [input.runId], messageRoles: ["user"] },
        );
        const run = runs.find((candidate) => candidate.id === input.runId);
        const message = messages.find((candidate) => candidate.id === run?.userMessageId);
        if (
          run?.status !== "starting" ||
          message === undefined ||
          !isUserAuthoredSideChatTrigger(message)
        ) {
          return;
        }
        if (
          !(yield* projections.hasSideChatChildren({
            projectId: thread.projectId,
            parentThreadId: thread.id,
          }))
        ) {
          return;
        }
        // Read before the children, so a note that settles after the read is still seen.
        const afterSequence = yield* eventSink.latestSequence();
        const children = sideChatChildren(
          yield* projections.getSideChatThreads({
            projectId: thread.projectId,
            lessonThreadId: sideChatLessonThreadId(thread),
          }),
          thread.id,
        );
        const generating = undeliveredGeneratingSideChats(thread, children);
        if (
          generating.length === 0 &&
          undeliveredReadySideChatNotes(thread, children).length === 0
        ) {
          return;
        }
        // The cap counts from the send, so a queued message does not wait again when it starts.
        yield* awaitSideChatNotes(
          generating,
          afterSequence,
          DateTime.add(run.requestedAt, { milliseconds: SIDE_CHAT_WAIT_CAP_MS }),
        );
        yield* threads.dispatch({
          type: "thread.side_chat.notes.attach",
          commandId: CommandId.make(`${input.runId}:side-chat-notes`),
          threadId: input.threadId,
          runId: input.runId,
        });
      },
      (effect, input) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning("Side-chat notes could not be attached", {
                  threadId: input.threadId,
                  runId: input.runId,
                  cause,
                }),
          ),
        ),
    );

  const writeOutcome: SideChatLifecycleService["Service"]["writeOutcome"] = Effect.fn(
    "SideChatLifecycleService.writeOutcome",
  )(function* (input) {
    const result: OutcomeResult | "stale" = yield* Effect.gen(function* () {
      const records = yield* threads.getThreadRecords(input.threadId, ["messages"], {
        messageRoles: ["user", "assistant"],
      });
      const { thread } = records;
      const sideChat = thread.sideChat;
      const outcome = sideChat?.done?.outcome;
      if (
        sideChat === undefined ||
        thread.deletedAt !== null ||
        outcome?.status !== "generating" ||
        outcome.requestId !== input.requestId
      ) {
        return "stale" as const;
      }

      const lesson = yield* threads.getThreadRecords(sideChat.lessonThreadId, []);
      const { text } = yield* writeSideChatText({
        thread: lesson.thread,
        kind: "outcome_note",
        prompt: buildSideChatOutcomeInput({
          excerpt: sideChat.excerpt,
          messages: records.messages
            .filter((message): message is TranscriptMessage => message.role !== "system")
            .toSorted(
              (left, right) =>
                DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
            ),
          childNotes: [],
          previousNote: null,
        }),
      });
      const note = normalizeSideChatNote(text);
      return (
        note === null ? { status: "none", note: null } : { status: "ready", note }
      ) satisfies OutcomeResult;
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Side chat note failed", {
              threadId: input.threadId,
              requestId: input.requestId,
              cause,
            }).pipe(
              Effect.as({
                status: "failed",
                note: null,
                error: failureDetail(cause),
              } satisfies OutcomeResult),
            ),
      ),
    );
    if (result === "stale") {
      return;
    }

    yield* threads
      .dispatch({
        type: "thread.side_chat.outcome.complete",
        commandId: CommandId.make(`${input.requestId}:outcome-complete`),
        threadId: input.threadId,
        requestId: input.requestId,
        ...result,
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Side chat note could not be recorded", {
                threadId: input.threadId,
                requestId: input.requestId,
                status: result.status,
                cause,
              }),
        ),
      );
  });

  return SideChatLifecycleService.of({ writeOutcome, awaitNotesForRunStart });
});

export const layer: Layer.Layer<
  SideChatLifecycleService,
  never,
  | ThreadManagementService.ThreadManagementService
  | ProjectionStore.ProjectionStoreV2
  | ProjectStore.ProjectStoreV2
  | EventSink.EventSinkV2
  | ServerSettings.ServerSettingsService
  | ProviderRegistry.ProviderRegistry
  | TextGeneration.TextGeneration
  | FileSystem.FileSystem
> = Layer.effect(SideChatLifecycleService, make);
