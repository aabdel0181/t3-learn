import {
  CommandId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2SideChat,
  type ThreadId,
} from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- A deterministic digest is required for the in-memory cache key.
import * as NodeCrypto from "node:crypto";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
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

const OPENING_SUMMARY_PROMPT_VERSION = "conversation-summary-v2";
const OPENING_SUMMARY_CACHE_MAX_ENTRIES = 64;
const OPENING_SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

interface ReadySummary {
  readonly type: "ready";
  readonly text: string;
  readonly expiresAt: number;
  readonly lastUsedAt: number;
}

interface InFlightSummary {
  readonly type: "in-flight";
  readonly deferred: Deferred.Deferred<OpeningResult, never>;
}

type SummaryCacheEntry = ReadySummary | InFlightSummary;

interface SummaryClaim {
  readonly kind: "owner" | "waiter" | "ready";
  readonly entry: SummaryCacheEntry;
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const writeSideChatText = yield* makeWriteSideChatText;
  const summaryCache = yield* Ref.make(new Map<string, SummaryCacheEntry>());

  const cacheKey = (input: string, modelSelection: unknown): string =>
    NodeCrypto.createHash("sha256")
      .update(JSON.stringify([OPENING_SUMMARY_PROMPT_VERSION, input, modelSelection]))
      .digest("hex");

  const claimSummary = Effect.fn("SideChatOpeningService.claimSummary")(
    (key: string, now: number): Effect.Effect<SummaryClaim> =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<OpeningResult, never>();
        return yield* Ref.modify(summaryCache, (entries) => {
          const next = new Map(entries);
          for (const [entryKey, entry] of next) {
            if (entry.type === "ready" && entry.expiresAt <= now) next.delete(entryKey);
          }
          const existing = next.get(key);
          if (existing?.type === "ready") {
            const refreshed = { ...existing, lastUsedAt: now };
            next.set(key, refreshed);
            const claim = { kind: "ready", entry: refreshed } satisfies SummaryClaim;
            return [claim, next] as readonly [SummaryClaim, Map<string, SummaryCacheEntry>];
          }
          if (existing?.type === "in-flight") {
            const claim = { kind: "waiter", entry: existing } satisfies SummaryClaim;
            return [claim, next] as readonly [SummaryClaim, Map<string, SummaryCacheEntry>];
          }
          const owner = { type: "in-flight", deferred } satisfies InFlightSummary;
          while (next.size >= OPENING_SUMMARY_CACHE_MAX_ENTRIES) {
            const oldest = [...next.entries()]
              .filter((entry): entry is [string, ReadySummary] => entry[1].type === "ready")
              .toSorted(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)[0];
            if (oldest === undefined) break;
            next.delete(oldest[0]);
          }
          next.set(key, owner);
          const claim = { kind: "owner", entry: owner } satisfies SummaryClaim;
          return [claim, next] as readonly [SummaryClaim, Map<string, SummaryCacheEntry>];
        });
      }),
  );

  const finishSummary = (key: string, owner: InFlightSummary, result: OpeningResult, now: number) =>
    Effect.uninterruptible(
      Ref.update(summaryCache, (entries) => {
        if (entries.get(key) !== owner) return entries;
        const next = new Map(entries);
        if (result.status === "ready" && result.text !== null) {
          next.set(key, {
            type: "ready",
            text: result.text,
            expiresAt: now + OPENING_SUMMARY_CACHE_TTL_MS,
            lastUsedAt: now,
          });
        } else {
          next.delete(key);
        }
        return next;
      }).pipe(Effect.andThen(Deferred.succeed(owner.deferred, result))),
    );

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
    const prompt = buildSideChatSummarizerInput({
      messages,
      anchor,
      excerpt: sideChat.excerpt,
      anchorOpeningText: anchorRecords.thread.sideChat?.opening.text ?? null,
    });
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      lesson.projectId,
    ).settings;
    const modelSelection = ServerSettings.resolveSideChatTextModel(
      lesson,
      settings,
      yield* providerRegistry.getProviders,
    );
    const key = cacheKey(prompt, modelSelection);

    while (true) {
      const now = yield* Clock.currentTimeMillis;
      const claim = yield* claimSummary(key, now);
      if (claim.kind === "ready" && claim.entry.type === "ready") {
        return { status: "ready", text: claim.entry.text } satisfies OpeningResult;
      }
      if (claim.kind === "waiter" && claim.entry.type === "in-flight") {
        const result = yield* Deferred.await(claim.entry.deferred);
        if (result.status === "ready") return result;
        continue;
      }

      const owner = claim.entry;
      if (owner.type !== "in-flight") continue;
      const writeExit = yield* Effect.exit(
        writeSideChatText({
          thread: lesson,
          kind: "opening_summary",
          prompt,
        }),
      );
      const outcome = Exit.match(writeExit, {
        onSuccess: ({ text }) => ({
          result: (text === null
            ? { status: "fallback", text: null }
            : { status: "ready", text }) satisfies OpeningResult,
          cause: null,
        }),
        onFailure: (cause) => ({
          result: { status: "failed", text: null } satisfies OpeningResult,
          cause,
        }),
      });
      yield* finishSummary(key, owner, outcome.result, now);
      if (outcome.cause !== null) return yield* Effect.failCause(outcome.cause);
      return outcome.result;
    }
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
