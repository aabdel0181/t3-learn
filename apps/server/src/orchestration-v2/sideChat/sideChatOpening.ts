import type { CommandId, ThreadId } from "@t3tools/contracts";

import type { PendingOrchestrationEffectV2 } from "../EffectOutbox.ts";

/** The outbox id of a side chat's opening summary. The open command's id is its request id. */
export function sideChatOpeningEffectId(requestId: string): string {
  return `effect:${requestId}:side-chat.opening`;
}

/** Writes the opening summary of the side chat that `commandId` opened. */
export function pendingSideChatOpeningEffect(
  commandId: CommandId,
  threadId: ThreadId,
): PendingOrchestrationEffectV2 {
  return {
    id: sideChatOpeningEffectId(commandId),
    commandId,
    threadId,
    request: { type: "side-chat.opening" },
  };
}
