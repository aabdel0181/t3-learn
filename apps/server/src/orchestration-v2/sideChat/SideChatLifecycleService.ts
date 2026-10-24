import {
  CommandId,
  type OrchestrationV2AppThread,
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
  nestedSideChatNotesFallback,
  normalizeSideChatNote,
} from "./notes.ts";
import {
  readySideChatNotes,
  sideChatChildren,
  sideChatLessonThreadId,
  undeliveredGeneratingSideChats,
  undeliveredReadySideChatNotes,
} from "./tree.ts";
import { makeWriteSideChatText } from "./writeSideChatText.ts";

type SideChatCascadeAction = "archive" | "unarchive" | "delete";

export class SideChatLifecycleService extends Context.Service<
  SideChatLifecycleService,
  {
    /**
     * Writes the note for the side chat's `generating` outcome `requestId` and lands it with
     * `thread.side_chat.outcome.complete`. The note takes up the notes of its nested side chats:
     * the ones its own turns took, and every ready one, after waiting for ones still being written
     * until `SIDE_CHAT_WAIT_CAP_MS` after Done. Until the lesson has received one of this side
     * chat's notes, a null answer makes those notes the note; after that it says only what is new.
     * Never fails: interrupts propagate, and anything else is logged and recorded as `failed`,
     * because a failed outbox row pins the lesson's worktree.
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
    /**
     * Archives, unarchives or deletes the side chats directly below the thread, as the thread's
     * own `commandId` did to it. Each one's own command does the same to the side chats below it.
     * Never fails: interrupts propagate, and anything else is logged, child by child.
     */
    readonly cascade: (input: {
      readonly threadId: ThreadId;
      readonly action: SideChatCascadeAction;
      readonly commandId: CommandId;
    }) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/sideChat/SideChatLifecycleService") {}

const SIDE_CHAT_CASCADE_COMMAND_TYPES = {
  archive: "thread.archive",
  unarchive: "thread.unarchive",
  delete: "thread.delete",
} as const;

/** Whether `action` has nothing left to do to `thread`. */
const isInCascadeTargetState = (
  thread: OrchestrationV2AppThread,
  action: SideChatCascadeAction,
): boolean => {
  switch (action) {
    case "archive":
      return thread.archivedAt !== null;
    case "unarchive":
      return thread.archivedAt === null;
    case "delete":
      return thread.deletedAt !== null;
  }
};

/** The nested side chats whose notes a written note took up the chain, by the note's request. */
interface ChildNoteDeliveries {
  readonly childNoteDeliveries?: Readonly<Record<ThreadId, string>>;
}

type OutcomeResult =
  | ({ readonly status: "ready"; readonly note: string } & ChildNoteDeliveries)
  | ({ readonly status: "none"; readonly note: null } & ChildNoteDeliveries)
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
      // Read before the nested side chats, so a note of theirs that settles after the read is
      // still seen.
      const afterSequence = yield* eventSink.latestSequence();
      const records = yield* threads.getThreadRecords(
        input.threadId,
        ["messages", "contextHandoffs"],
        { messageRoles: ["user", "assistant"] },
      );
      const { thread } = records;
      const sideChat = thread.sideChat;
      const done = sideChat?.done;
      if (
        sideChat === undefined ||
        done == null ||
        thread.deletedAt !== null ||
        done.outcome.status !== "generating" ||
        done.outcome.requestId !== input.requestId
      ) {
        return "stale" as const;
      }

      const readChildren = projections
        .getSideChatThreads({
          projectId: thread.projectId,
          lessonThreadId: sideChat.lessonThreadId,
        })
        .pipe(Effect.map((sideChats) => sideChatChildren(sideChats, thread.id)));
      let children = yield* readChildren;
      const generating = undeliveredGeneratingSideChats(thread, children);
      if (generating.length > 0) {
        // The cap counts from Done, which started the nested side chats' notes too.
        yield* awaitSideChatNotes(
          generating,
          afterSequence,
          DateTime.add(DateTime.makeUnsafe(done.at), { milliseconds: SIDE_CHAT_WAIT_CAP_MS }),
        );
        children = yield* readChildren;
      }
      // Every ready note, not only undelivered ones: one an earlier Done took up went no further
      // if this side chat reopened before its parent received that note. The previous note below
      // keeps the writer from repeating what the lesson already has.
      const childNotes = readySideChatNotes(children);
      const nestedNotes = { childNotes, contextHandoffs: records.contextHandoffs };
      const previousNote = sideChat.deliveredNote ?? null;

      const lesson = yield* threads.getThreadRecords(sideChat.lessonThreadId, []);
      const { text } = yield* writeSideChatText({
        thread: lesson.thread,
        kind: "outcome_note",
        prompt: buildSideChatOutcomeInput({
          ...nestedNotes,
          excerpt: sideChat.excerpt,
          messages: records.messages
            .filter((message): message is TranscriptMessage => message.role !== "system")
            .toSorted(
              (left, right) =>
                DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
            ),
          previousNote,
        }),
      });
      // Once the lesson holds a note of this side chat, null means nothing new, and a fallback
      // would send again what that note already carried.
      const note =
        normalizeSideChatNote(text) ??
        (previousNote === null ? nestedSideChatNotesFallback(nestedNotes) : null);
      const deliveries =
        childNotes.length === 0
          ? {}
          : {
              childNoteDeliveries: Object.fromEntries(
                childNotes.map((childNote) => [childNote.threadId, childNote.requestId]),
              ),
            };
      return (
        note === null
          ? { status: "none", note: null, ...deliveries }
          : { status: "ready", note, ...deliveries }
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

  const cascade: SideChatLifecycleService["Service"]["cascade"] = Effect.fn(
    "SideChatLifecycleService.cascade",
  )(
    function* (input) {
      // A deleted thread still reads, so a delete reaches the side chats below it.
      const thread = yield* projections.getThread(input.threadId);
      const children = sideChatChildren(
        yield* projections.getSideChatThreads({
          projectId: thread.projectId,
          lessonThreadId: sideChatLessonThreadId(thread),
        }),
        thread.id,
      ).filter((child) => !isInCascadeTargetState(child, input.action));
      yield* Effect.forEach(
        children,
        (child) =>
          threads
            .dispatch({
              type: SIDE_CHAT_CASCADE_COMMAND_TYPES[input.action],
              commandId: CommandId.make(`${input.commandId}:side-chat-cascade:${child.id}`),
              threadId: child.id,
            })
            .pipe(
              Effect.asVoid,
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.interrupt
                  : Effect.logWarning("Side chat could not follow its parent", {
                      parentThreadId: input.threadId,
                      threadId: child.id,
                      action: input.action,
                      cause,
                    }),
              ),
            ),
        { discard: true },
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Side chats could not follow their parent", {
                threadId: input.threadId,
                action: input.action,
                cause,
              }),
        ),
      ),
  );

  return SideChatLifecycleService.of({ writeOutcome, awaitNotesForRunStart, cascade });
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
