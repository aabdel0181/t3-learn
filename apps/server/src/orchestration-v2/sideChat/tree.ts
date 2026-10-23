import type { OrchestrationV2AppThread, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type SideChatChildThread = Pick<OrchestrationV2AppThread, "id" | "sideChat">;

/** The lesson a thread belongs to: a side chat stores it, a lesson is its own. */
export function sideChatLessonThreadId(
  thread: Pick<OrchestrationV2AppThread, "id" | "sideChat">,
): ThreadId {
  return thread.sideChat?.lessonThreadId ?? thread.id;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function compareCreation(
  left: Pick<OrchestrationV2AppThread, "id" | "createdAt">,
  right: Pick<OrchestrationV2AppThread, "id" | "createdAt">,
): number {
  return (
    DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt) ||
    compareText(left.id, right.id)
  );
}

const isLiveSideChat = (thread: OrchestrationV2AppThread): boolean =>
  thread.sideChat !== undefined && thread.deletedAt === null;

/** Side chats that are not deleted and sit directly below `parentThreadId`, oldest first. */
export function sideChatChildren(
  threads: ReadonlyArray<OrchestrationV2AppThread>,
  parentThreadId: ThreadId,
): ReadonlyArray<OrchestrationV2AppThread> {
  return threads
    .filter((thread) => isLiveSideChat(thread) && thread.lineage.parentThreadId === parentThreadId)
    .toSorted(compareCreation);
}

export interface SideChatDescendant {
  readonly thread: OrchestrationV2AppThread;
  readonly depth: number;
}

/**
 * Every side chat reachable from `rootThreadId` through live side chats, deepest first, then
 * oldest first. Orphans, cycles and anything below a deleted side chat are not reachable.
 */
export function sideChatDescendants(
  threads: ReadonlyArray<OrchestrationV2AppThread>,
  rootThreadId: ThreadId,
): ReadonlyArray<SideChatDescendant> {
  const childrenByParentId = new Map<ThreadId, OrchestrationV2AppThread[]>();
  for (const thread of threads) {
    const parentThreadId = thread.lineage.parentThreadId;
    if (parentThreadId === null || !isLiveSideChat(thread)) continue;
    const siblings = childrenByParentId.get(parentThreadId);
    if (siblings === undefined) childrenByParentId.set(parentThreadId, [thread]);
    else siblings.push(thread);
  }

  const seen = new Set<ThreadId>([rootThreadId]);
  const descendants: SideChatDescendant[] = [];
  let level: ReadonlyArray<ThreadId> = [rootThreadId];
  for (let depth = 1; level.length > 0; depth += 1) {
    const next: ThreadId[] = [];
    for (const parentThreadId of level) {
      for (const thread of childrenByParentId.get(parentThreadId) ?? []) {
        if (seen.has(thread.id)) continue;
        seen.add(thread.id);
        descendants.push({ thread, depth });
        next.push(thread.id);
      }
    }
    level = next;
  }

  return descendants.toSorted(
    (left, right) => right.depth - left.depth || compareCreation(left.thread, right.thread),
  );
}

/**
 * Request id of a side chat's `side-chat.outcome` effect. The outbox breaks claim ties by effect
 * id, so deeper side chats, whose notes their parents wait for, sort and are claimed first.
 */
export function sideChatOutcomeRequestId(
  commandId: string,
  depth: number,
  threadId: ThreadId,
): string {
  return `${commandId}:side-chat-done:${String(999 - depth).padStart(3, "0")}:${threadId}`;
}

export interface ReadySideChatNote {
  readonly threadId: ThreadId;
  readonly requestId: string;
  readonly label: string;
  readonly note: string;
  readonly at: string;
}

const hasDelivered = (
  parent: Pick<OrchestrationV2AppThread, "sideChatNoteDeliveries">,
  childThreadId: ThreadId,
  requestId: string,
): boolean => parent.sideChatNoteDeliveries?.[childThreadId] === requestId;

/** Notes of `children` that are ready and that `parent` has not received, oldest first. */
export function undeliveredReadySideChatNotes(
  parent: Pick<OrchestrationV2AppThread, "sideChatNoteDeliveries">,
  children: ReadonlyArray<SideChatChildThread>,
): ReadonlyArray<ReadySideChatNote> {
  const notes: ReadySideChatNote[] = [];
  for (const { id, sideChat } of children) {
    const done = sideChat?.done;
    if (sideChat === undefined || done == null) continue;
    const { status, note, requestId } = done.outcome;
    if (status !== "ready" || note === null || hasDelivered(parent, id, requestId)) continue;
    notes.push({ threadId: id, requestId, label: sideChat.label, note, at: done.at });
  }
  // `at` is an ISO string, so it sorts lexically.
  return notes.toSorted(
    (left, right) => compareText(left.at, right.at) || compareText(left.threadId, right.threadId),
  );
}

/** Children whose note is still being written and that `parent` has not received. */
export function undeliveredGeneratingSideChats(
  parent: Pick<OrchestrationV2AppThread, "sideChatNoteDeliveries">,
  children: ReadonlyArray<SideChatChildThread>,
): ReadonlyArray<ThreadId> {
  return children
    .filter(({ id, sideChat }) => {
      const outcome = sideChat?.done?.outcome;
      return outcome?.status === "generating" && !hasDelivered(parent, id, outcome.requestId);
    })
    .map(({ id }) => id);
}
