import {
  CommandId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2SideChat,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../ThreadManagementService.ts";
import { buildSideChatSummarizerInput } from "./sideChatText.ts";
import { makeWriteSideChatText } from "./writeSideChatText.ts";

export class SideChatOpeningService extends Context.Service<
  SideChatOpeningService,
  {
    /**
     * Writes the opening summary for the side chat's pending `requestId` and lands it with
     * `thread.side_chat.opening.complete`. Never fails: interrupts propagate, and anything else is
     * logged and recorded as `failed`, because a failed outbox row pins the lesson's worktree.
     */
    readonly execute: (input: {
      readonly threadId: ThreadId;
      readonly requestId: CommandId;
    }) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/sideChat/SideChatOpeningService") {}

interface OpeningResult {
  readonly status: "ready" | "fallback" | "failed";
  readonly text: string | null;
}

type SummarizerMessage = OrchestrationV2ConversationMessage & {
  readonly role: "user" | "assistant";
};

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const writeSideChatText = yield* makeWriteSideChatText;

  const summarize = Effect.fn("SideChatOpeningService.summarize")(function* (
    sideChat: OrchestrationV2SideChat,
  ) {
    const { anchor } = sideChat;
    const anchorRecords = yield* threads.getThreadRecords(anchor.threadId, ["messages"], {
      messageRoles: ["user", "assistant"],
    });
    const messages = anchorRecords.messages.filter(
      (message): message is SummarizerMessage => !message.streaming && message.role !== "system",
    );
    // A rollback or edit removed the highlighted reply; falling back keeps the side chat usable.
    if (!messages.some((message) => message.id === anchor.messageId)) {
      return { status: "fallback", text: null } satisfies OpeningResult;
    }

    const lesson =
      anchorRecords.thread.id === sideChat.lessonThreadId
        ? anchorRecords.thread
        : (yield* threads.getThreadRecords(sideChat.lessonThreadId, [])).thread;
    const { text } = yield* writeSideChatText({
      thread: lesson,
      kind: "opening_summary",
      prompt: buildSideChatSummarizerInput({
        messages,
        anchor,
        excerpt: sideChat.excerpt,
        anchorOpeningText: anchorRecords.thread.sideChat?.opening.text ?? null,
      }),
    });
    return (
      text === null ? { status: "fallback", text: null } : { status: "ready", text }
    ) satisfies OpeningResult;
  });

  const execute: SideChatOpeningService["Service"]["execute"] = Effect.fn(
    "SideChatOpeningService.execute",
  )(function* (input) {
    const result: OpeningResult | "stale" = yield* Effect.gen(function* () {
      const { thread } = yield* threads.getThreadRecords(input.threadId, []);
      const sideChat = thread.sideChat;
      if (
        sideChat === undefined ||
        thread.deletedAt !== null ||
        sideChat.opening.status !== "pending" ||
        sideChat.opening.requestId !== input.requestId
      ) {
        return "stale" as const;
      }
      return yield* summarize(sideChat);
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Side chat opening summary failed", {
              threadId: input.threadId,
              requestId: input.requestId,
              cause,
            }).pipe(Effect.as({ status: "failed", text: null } satisfies OpeningResult)),
      ),
    );
    if (result === "stale") {
      return;
    }

    yield* threads
      .dispatch({
        type: "thread.side_chat.opening.complete",
        commandId: CommandId.make(`${input.requestId}:side-chat-opening-complete`),
        threadId: input.threadId,
        requestId: input.requestId,
        status: result.status,
        text: result.text,
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Side chat opening summary could not be recorded", {
                threadId: input.threadId,
                requestId: input.requestId,
                status: result.status,
                cause,
              }),
        ),
      );
  });

  return SideChatOpeningService.of({ execute });
});

export const layer = Layer.effect(SideChatOpeningService, make);
