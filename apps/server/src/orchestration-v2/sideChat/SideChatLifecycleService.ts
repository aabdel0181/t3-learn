import {
  CommandId,
  type OrchestrationV2ConversationMessage,
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

import type * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import type * as ServerSettings from "../../serverSettings.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import type * as EventSink from "../EventSink.ts";
import type * as ProjectionStore from "../ProjectionStore.ts";
import type * as ProjectStore from "../ProjectStore.ts";
import * as ThreadManagementService from "../ThreadManagementService.ts";
import { buildSideChatOutcomeInput, normalizeSideChatNote } from "./notes.ts";
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

/** The text generation's own explanation when it failed, otherwise a generic one. */
const failureDetail = (cause: Cause.Cause<unknown>): string =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => "Couldn't write the note.",
    onSome: (error) => (isTextGenerationError(error) ? error.detail : "Couldn't write the note."),
  });

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const writeSideChatText = yield* makeWriteSideChatText;

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

  return SideChatLifecycleService.of({ writeOutcome });
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
