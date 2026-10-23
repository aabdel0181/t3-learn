import {
  SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
  SIDE_CHAT_NOTES_HANDOFF_TITLE,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const ACTIVE_SUBAGENT_STATUSES = new Set<OrchestrationV2Subagent["status"]>([
  "pending",
  "running",
  "waiting",
]);

/**
 * Whether a subagent started another run after a notification reported its
 * final outcome, so that outcome no longer describes it. Claude resumes a
 * finished subagent under the same id. An active subagent is always on a later
 * run, even when the notification was delivered late from the queue; a settled
 * one is on a later run when it started after the notification arrived.
 */
export function subagentResumedSince(
  agent: Pick<OrchestrationV2Subagent, "status" | "startedAt">,
  notifiedAt: string,
): boolean {
  if (ACTIVE_SUBAGENT_STATUSES.has(agent.status)) return true;
  if (agent.startedAt === null) return false;
  const notifiedAtMillis = Date.parse(notifiedAt);
  return (
    !Number.isNaN(notifiedAtMillis) && DateTime.toEpochMillis(agent.startedAt) > notifiedAtMillis
  );
}

const SIDE_CHAT_HANDOFF_TITLES: ReadonlySet<string> = new Set([
  SIDE_CHAT_CONTEXT_HANDOFF_TITLE,
  SIDE_CHAT_NOTES_HANDOFF_TITLE,
]);

/**
 * The divider label for a handoff that carries side chat text, or null for any other item. Side
 * chats reuse the `manual_context` handoff; the title tells them apart from a provider switch.
 */
export function sideChatHandoffDividerLabel(item: OrchestrationV2TurnItem): string | null {
  if (item.type !== "handoff" || item.strategy !== "manual_context") return null;
  return item.title !== null && SIDE_CHAT_HANDOFF_TITLES.has(item.title) ? item.title : null;
}
