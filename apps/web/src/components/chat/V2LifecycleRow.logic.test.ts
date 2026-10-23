import {
  ContextHandoffId,
  ProviderInstanceId,
  ProviderThreadId,
  SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
  SIDE_CHAT_NOTES_HANDOFF_TITLE,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { sideChatHandoffDividerLabel, subagentResumedSince } from "./V2LifecycleRow.logic";

const failedAt = "2026-10-09T12:21:00.000Z";
const beforeFailure = DateTime.makeUnsafe("2026-10-09T12:05:00.000Z");
const afterFailure = DateTime.makeUnsafe("2026-10-09T12:48:00.000Z");

describe("subagentResumedSince", () => {
  it("is true while it runs even when the notification was delivered after the resume", () => {
    expect(
      subagentResumedSince(
        { status: "running", startedAt: afterFailure },
        "2026-10-09T12:50:00.000Z",
      ),
    ).toBe(true);
  });

  // regression: #18099 a resumed subagent's old failure notification row showed failed instead of resumed
  it("is true once a run started after the notification has settled", () => {
    expect(subagentResumedSince({ status: "completed", startedAt: afterFailure }, failedAt)).toBe(
      true,
    );
  });

  it("is false for the run the notification reported on", () => {
    expect(subagentResumedSince({ status: "failed", startedAt: beforeFailure }, failedAt)).toBe(
      false,
    );
  });
});

describe("sideChatHandoffDividerLabel", () => {
  const now = DateTime.makeUnsafe("2026-10-09T12:00:00.000Z");
  const base = {
    id: TurnItemId.make("item-handoff"),
    threadId: ThreadId.make("thread-handoff"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed" as const,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  };
  const handoff = (
    title: string | null,
    strategy: Extract<OrchestrationV2TurnItem, { type: "handoff" }>["strategy"],
  ) =>
    ({
      ...base,
      title,
      type: "handoff" as const,
      contextHandoffId: ContextHandoffId.make("handoff-1"),
      fromProviderThreadIds: [],
      toProviderThreadId: ProviderThreadId.make("provider-thread-1"),
      fromProviderInstanceIds: [],
      toProviderInstanceId: ProviderInstanceId.make("codex-default"),
      strategy,
    }) satisfies OrchestrationV2TurnItem;

  it("labels a manual-context handoff titled for the side chat context", () => {
    expect(
      sideChatHandoffDividerLabel(handoff(SIDE_CHAT_CONTEXT_HANDOFF_TITLE, "manual_context")),
    ).toBe("Side chat context");
  });

  it("labels a manual-context handoff titled for the included notes", () => {
    expect(
      sideChatHandoffDividerLabel(handoff(SIDE_CHAT_NOTES_HANDOFF_TITLE, "manual_context")),
    ).toBe("Side-chat notes included");
  });

  it("leaves provider-switch handoffs to the provider-switch row", () => {
    expect(sideChatHandoffDividerLabel(handoff(null, "manual_context"))).toBeNull();
    expect(sideChatHandoffDividerLabel(handoff("Switched provider", "manual_context"))).toBeNull();
    expect(
      sideChatHandoffDividerLabel(handoff(SIDE_CHAT_CONTEXT_HANDOFF_TITLE, "full_thread_summary")),
    ).toBeNull();
  });

  it("is null for an item that is not a handoff", () => {
    const compaction = {
      ...base,
      title: SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
      type: "compaction" as const,
      driver: null,
    } satisfies OrchestrationV2TurnItem;
    expect(sideChatHandoffDividerLabel(compaction)).toBeNull();
  });
});
