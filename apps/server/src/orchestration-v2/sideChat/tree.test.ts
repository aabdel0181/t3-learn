import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2SideChat,
  type OrchestrationV2SideChatOutcome,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  sideChatChildren,
  sideChatDescendants,
  sideChatLessonThreadId,
  sideChatOutcomeRequestId,
  undeliveredGeneratingSideChats,
  undeliveredReadySideChatNotes,
} from "./tree.ts";

const NOW_MS = Date.parse("2026-10-22T12:00:00.000Z");
const SECOND_MS = 1_000;
const at = (seconds: number) => DateTime.makeUnsafe(NOW_MS + seconds * SECOND_MS);
const isoAt = (seconds: number) => DateTime.formatIso(at(seconds));

const instanceId = ProviderInstanceId.make("claudeAgent");
const modelSelection = { instanceId, model: "claude-opus-5-5" };
const lessonId = ThreadId.make("lesson");

function sideChatState(
  done: { readonly atSeconds: number; readonly outcome: OrchestrationV2SideChatOutcome } | null,
  label = "label",
): OrchestrationV2SideChat {
  return {
    lessonThreadId: lessonId,
    anchor: {
      threadId: lessonId,
      messageId: MessageId.make("message-1"),
      start: 0,
      end: 5,
      prefix: "",
      suffix: "",
    },
    excerpt: "highlight",
    excerptContext: "",
    label,
    opening: { status: "ready", text: "summary", requestId: "opening-1" },
    done: done === null ? null : { at: isoAt(done.atSeconds), outcome: done.outcome },
  };
}

function thread(
  id: string,
  options: { readonly parent?: string; readonly createdAtSeconds?: number } & Partial<
    Pick<OrchestrationV2AppThread, "sideChat" | "sideChatNoteDeliveries" | "deletedAt">
  > = {},
): OrchestrationV2AppThread {
  const { parent, createdAtSeconds = 0, ...rest } = options;
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    projectId: ProjectId.make("project"),
    title: id,
    createdBy: "user",
    creationSource: "web",
    providerInstanceId: instanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage:
      parent === undefined
        ? { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null }
        : {
            rootThreadId: lessonId,
            parentThreadId: ThreadId.make(parent),
            relationshipToParent: "fork",
          },
    forkedFrom: null,
    createdAt: at(createdAtSeconds),
    updatedAt: at(createdAtSeconds),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...rest,
  };
}

const sideChat = (
  id: string,
  parent: string,
  createdAtSeconds: number,
  overrides: Partial<Pick<OrchestrationV2AppThread, "sideChat" | "deletedAt">> = {},
) => thread(id, { parent, createdAtSeconds, sideChat: sideChatState(null), ...overrides });

const ids = (threads: ReadonlyArray<{ readonly id: ThreadId }>) => threads.map(({ id }) => id);

describe("side-chat tree", () => {
  it("lists side chats below a thread deepest first, skipping deleted, orphaned and cyclic ones", () => {
    const threads = [
      thread("lesson"),
      // Siblings created together fall back to id order, whatever order they arrive in.
      sideChat("side:b", "lesson", 1),
      sideChat("side:a", "lesson", 1),
      sideChat("side:a1", "side:a", 2),
      sideChat("side:a1x", "side:a1", 3),
      // A plain fork of the lesson is not a side chat.
      thread("fork", { parent: "lesson", createdAtSeconds: 1 }),
      sideChat("side:orphan", "missing-parent", 1),
      sideChat("side:c1", "side:c2", 1),
      sideChat("side:c2", "side:c1", 1),
      sideChat("side:gone", "lesson", 1, { deletedAt: at(5) }),
      // A live side chat below a deleted one is no longer reachable.
      sideChat("side:below-gone", "side:gone", 2),
    ];

    expect(
      sideChatDescendants(threads, lessonId).map(({ thread: child, depth }) => [child.id, depth]),
    ).toEqual([
      ["side:a1x", 3],
      ["side:a1", 2],
      ["side:a", 1],
      ["side:b", 1],
    ]);
    expect(
      ids(sideChatDescendants(threads, ThreadId.make("side:a")).map(({ thread: child }) => child)),
    ).toEqual(["side:a1x", "side:a1"]);
    expect(ids(sideChatChildren(threads, lessonId))).toEqual(["side:a", "side:b"]);
    // Walking a cycle from inside it never returns the root as its own descendant.
    expect(
      sideChatDescendants(threads, ThreadId.make("side:c1")).map(({ thread: child, depth }) => [
        child.id,
        depth,
      ]),
    ).toEqual([["side:c2", 1]]);

    // The lesson of a side chat is stored on it; a lesson is its own.
    expect(sideChatLessonThreadId(thread("lesson"))).toBe("lesson");
    expect(sideChatLessonThreadId(sideChat("side:a1", "side:a", 2))).toBe("lesson");
  });

  it("orders outcome request ids so deeper side chats are claimed first", () => {
    const shallow = sideChatOutcomeRequestId("command:done", 1, ThreadId.make("side:a"));
    const deep = sideChatOutcomeRequestId("command:done", 3, ThreadId.make("side:a1x"));

    expect(shallow).toBe("command:done:side-chat-done:998:side:a");
    expect(deep).toBe("command:done:side-chat-done:996:side:a1x");
    expect([shallow, deep].toSorted()).toEqual([deep, shallow]);
  });

  it("collects the ready notes a parent has not received, oldest first", () => {
    const child = (id: string, outcome: OrchestrationV2SideChatOutcome | null, atSeconds = 0) =>
      sideChat(id, "lesson", 1, {
        sideChat: sideChatState(outcome === null ? null : { atSeconds, outcome }, `label ${id}`),
      });
    const ready = (requestId: string, note: string | null) => ({
      status: "ready" as const,
      note,
      requestId,
    });
    const parent = thread("lesson", {
      sideChatNoteDeliveries: {
        [ThreadId.make("side:a")]: "r-old",
        [ThreadId.make("side:b")]: "r-b",
      },
    });
    const children = [
      child("side:a", ready("r-a", "note a"), 20),
      child("side:b", ready("r-b", "note b"), 10),
      child("side:c", null),
      child("side:d", { status: "generating", note: null, requestId: "r-d" }, 12),
      child("side:e", ready("r-e", "note e"), 15),
      // A ready outcome with no note has nothing to deliver.
      child("side:f", ready("r-f", null), 5),
      // Ready together with side:e, so thread id decides.
      child("side:ee", ready("r-ee", "note ee"), 15),
    ];

    expect(undeliveredReadySideChatNotes(parent, children)).toEqual([
      {
        threadId: "side:e",
        requestId: "r-e",
        label: "label side:e",
        note: "note e",
        at: isoAt(15),
      },
      {
        threadId: "side:ee",
        requestId: "r-ee",
        label: "label side:ee",
        note: "note ee",
        at: isoAt(15),
      },
      {
        threadId: "side:a",
        requestId: "r-a",
        label: "label side:a",
        note: "note a",
        at: isoAt(20),
      },
    ]);
    expect(undeliveredGeneratingSideChats(parent, children)).toEqual(["side:d"]);
  });
});
