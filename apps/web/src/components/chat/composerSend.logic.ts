import type {
  EnvironmentId,
  OrchestrationMessageContext,
  ThreadContextRecord,
} from "@t3tools/contracts";
import { collectInlineContextIds } from "../../lib/composerContextReferences";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import { getAntigravitySendBlockReason } from "../ChatView.logic";
import { formatOutgoingPrompt, withMessageContext } from "../ChatView.logic";
import { getComposerPromptLengthValidationMessage } from "./composerSubmission";

/** Attached threads the prompt still links to; replacing linked text leaves stale records. */
export function referencedThreadContexts(draft: {
  readonly prompt: string;
  readonly threadContexts: ReadonlyArray<ThreadContextRecord>;
}): ReadonlyArray<ThreadContextRecord> {
  if (draft.threadContexts.length === 0) return [];
  const referenced = new Set(collectInlineContextIds(draft.prompt));
  return draft.threadContexts.filter((record) => referenced.has(record.contextId));
}

/** Why a send waits for the user to pick a machine when no machine was chosen automatically. */
export function loadBalancingSendWarning(input: {
  readonly pending: boolean;
  readonly threadContexts: ReadonlyArray<ThreadContextRecord>;
  readonly candidateEnvironmentIds: ReadonlyArray<EnvironmentId>;
}) {
  if (input.pending) {
    return {
      title: "Checking machine resources",
      description: "Resource checks are still running. You can choose a machine in the composer.",
    };
  }
  const noMachineReadsEveryThread =
    input.threadContexts.length > 0 &&
    !input.candidateEnvironmentIds.some((environmentId) =>
      input.threadContexts.every((record) => record.environmentId === environmentId),
    );
  return {
    title: "Choose a machine to continue",
    description: noMachineReadsEveryThread
      ? "No machine can read every attached thread. Choose a machine in the composer or remove the threads."
      : "No eligible machine has available resources. Choose a machine in the composer to override.",
  };
}

/**
 * Why a multiple-model send cannot start: the server predates worktree bootstrap, or the
 * draft is not a new thread on a Git branch with at least one model.
 */
export function multipleModelSendBlock(input: {
  readonly selectionCount: number;
  readonly serverSupportsWorktreeBootstrap: boolean;
  readonly isLocalDraftThread: boolean;
  readonly isGitRepo: boolean;
  readonly branch: string | null;
}): "server-outdated" | "needs-new-git-thread" | null {
  if (!input.serverSupportsWorktreeBootstrap) return "server-outdated";
  if (
    !input.isLocalDraftThread ||
    !input.isGitRepo ||
    !input.branch ||
    input.selectionCount === 0
  ) {
    return "needs-new-git-thread";
  }
  return null;
}

/** Why a message sent over pending approvals did not go out, or null to stop quietly. */
export function approvalRedirectNotice(input: {
  readonly draftChanged: boolean;
  readonly declined: boolean;
  readonly approvalResponding: boolean;
  readonly approvalArrived: boolean;
}): string | null {
  if (input.draftChanged) {
    return input.declined
      ? "Approval declined. Your message changed, so it wasn't sent."
      : "Your message changed, so it wasn't sent.";
  }
  if (input.approvalResponding) {
    return "An approval is already being answered, so your message wasn't sent.";
  }
  if (input.declined && input.approvalArrived) {
    return "Another approval arrived, so your message wasn't sent.";
  }
  return null;
}

export type SideChatSendPlan =
  | {
      readonly _tag: "Blocked";
      readonly reason:
        | "no-operate-scope"
        | "in-flight"
        | "starting"
        | "provider-unavailable"
        | "antigravity-unavailable"
        | "empty";
      readonly message?: string;
    }
  | { readonly _tag: "AnswerPendingInput" }
  | { readonly _tag: "Invalid"; readonly message: string }
  | {
      readonly _tag: "Ready";
      readonly outgoingText: string;
      readonly message: { readonly text: string; readonly context?: OrchestrationMessageContext };
    };

/**
 * What Send does in the side-chat composer. The checks run in order: scope, in-flight, starting,
 * pending-input answer, provider, Antigravity, empty, then length. It reuses the lesson
 * composer's prompt helpers; `useComposerSend`'s own guards carry lesson-only concerns.
 */
export function planSideChatSend(input: {
  readonly canOperate: boolean;
  readonly sendInFlight: boolean;
  readonly shellReady: boolean;
  readonly answeringPendingUserInput: boolean;
  readonly providerEntry:
    | (Pick<ProviderInstanceEntry, "driverKind" | "enabled" | "isAvailable" | "models"> &
        Partial<Pick<ProviderInstanceEntry, "snapshot">>)
    | undefined;
  readonly model: string;
  readonly attachmentCount?: number;
  readonly prompt: string;
}): SideChatSendPlan {
  if (!input.canOperate) return { _tag: "Blocked", reason: "no-operate-scope" };
  if (input.sendInFlight) return { _tag: "Blocked", reason: "in-flight" };
  if (!input.shellReady) return { _tag: "Blocked", reason: "starting" };
  if (input.answeringPendingUserInput) return { _tag: "AnswerPendingInput" };
  const entry = input.providerEntry;
  if (entry === undefined || !entry.enabled || !entry.isAvailable) {
    return { _tag: "Blocked", reason: "provider-unavailable" };
  }
  const text = input.prompt.trim();
  const messageText =
    text.length === 0
      ? input.attachmentCount && input.attachmentCount > 0
        ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT
        : ""
      : text;
  const antigravityBlock = getAntigravitySendBlockReason(entry.snapshot, input.model);
  if (antigravityBlock !== null)
    return { _tag: "Blocked", reason: "antigravity-unavailable", message: antigravityBlock };
  if (messageText.length === 0) return { _tag: "Blocked", reason: "empty" };
  const outgoingText = formatOutgoingPrompt({
    provider: entry.driverKind,
    model: input.model,
    models: entry.models,
    effort: null,
    text: messageText,
  });
  const lengthMessage = getComposerPromptLengthValidationMessage(outgoingText);
  if (lengthMessage !== null) return { _tag: "Invalid", message: lengthMessage };
  return {
    _tag: "Ready",
    outgoingText,
    // The side chat sends images as attachments and quotes as text, so there are no context records to inline.
    message: withMessageContext({
      text: outgoingText,
      context: undefined,
    }),
  };
}
