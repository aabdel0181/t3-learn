import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { SideChatTreeRow } from "@t3tools/client-runtime/state/thread-relationships";
import type {
  AssistantCitation,
  EnvironmentId,
  OrchestrationV2Run,
  OrchestrationV2SideChatAnchor,
  OrchestrationV2SideChatOpening,
  OrchestrationV2ThreadShellSideChat,
  ThreadId,
} from "@t3tools/contracts";

export type SideChatCrumb = {
  readonly threadId: string;
  readonly label: string;
  readonly role: "lesson" | "ancestor" | "current" | "forward";
};

/** The lesson down to `threadId`. Empty when `threadId` is not in `rows`. */
export function sideChatPath(
  rows: ReadonlyArray<SideChatTreeRow>,
  threadId: string,
): ReadonlyArray<SideChatTreeRow> {
  const rowsById = new Map(rows.map((row) => [row.threadId as string, row]));
  const visited = new Set<string>();
  const path: SideChatTreeRow[] = [];
  for (
    let row = rowsById.get(threadId);
    row !== undefined && !visited.has(row.threadId);
    row = row.parentId === null ? undefined : rowsById.get(row.parentId)
  ) {
    visited.add(row.threadId);
    path.push(row);
  }
  return path.toReversed();
}

/** The side chats from the top one down to `threadId`, without the lesson. */
export function sideChatSurfacePath(
  rows: ReadonlyArray<SideChatTreeRow>,
  threadId: string,
): ReadonlyArray<string> {
  return sideChatPath(rows, threadId)
    .filter((row) => row.state !== "lesson")
    .map((row) => row.threadId);
}

/** The top-level side chat that holds `threadId`, which names its right-panel surface. */
export function topSideChatId(
  rows: ReadonlyArray<SideChatTreeRow>,
  threadId: string,
): string | null {
  return sideChatSurfacePath(rows, threadId)[0] ?? null;
}

/**
 * Lesson, ancestors and the current side chat, then the side chats of `trail`
 * below it: the ones the user walked back out of and can step into again.
 */
export function sideChatBreadcrumb(
  rows: ReadonlyArray<SideChatTreeRow>,
  threadId: string,
  trail: ReadonlyArray<string> | undefined,
): ReadonlyArray<SideChatCrumb> {
  const path = sideChatPath(rows, threadId);
  if (path.length === 0) return [];

  const crumbs: SideChatCrumb[] = path.map((row, index) => ({
    threadId: row.threadId,
    label: row.state === "lesson" ? "Lesson" : row.label,
    role: row.state === "lesson" ? "lesson" : index === path.length - 1 ? "current" : "ancestor",
  }));

  const trailIndex = trail?.indexOf(threadId) ?? -1;
  if (trail === undefined || trailIndex === -1) return crumbs;

  const rowsById = new Map(rows.map((row) => [row.threadId as string, row]));
  for (const forwardId of trail.slice(trailIndex + 1)) {
    const row = rowsById.get(forwardId);
    if (row !== undefined)
      crumbs.push({ threadId: row.threadId, label: row.label, role: "forward" });
  }
  return crumbs;
}

/**
 * What the panel says about a finished side chat's note. `note` is its text, once loaded.
 * A ready note waits for the user's next message in the parent, so it is only "sent" once the
 * parent recorded it. `parent.label` names a parent side chat, null for the lesson, and
 * `parent.delivered` is null until the parent's detail is known.
 */
export function sideChatStatusLine(
  sideChat: Pick<OrchestrationV2ThreadShellSideChat, "state" | "noteStatus"> | undefined,
  note: string | null,
  parent: { readonly label: string | null; readonly delivered: boolean | null },
): string | null {
  if (sideChat?.state !== "done") return null;
  switch (sideChat.noteStatus) {
    case "generating":
      return "Writing note…";
    case "ready": {
      if (note === null || note === "" || parent.delivered === null) return null;
      if (parent.label === null) {
        return parent.delivered
          ? `Sent to lesson: ${note}`
          : `Goes with your next lesson message: ${note}`;
      }
      return parent.delivered
        ? `Sent to “${parent.label}”: ${note}`
        : `Goes with your next message in “${parent.label}”: ${note}`;
    }
    case "none":
      return "No note needed";
    case "failed":
      return "Couldn't write the note";
    case null:
      return null;
  }
}

const SIDE_CHAT_PROVIDER_UNAVAILABLE =
  "This side chat's provider is unavailable. Enable it in Settings → Providers.";
const SIDE_CHAT_PROVIDER_MISSING =
  "This side chat's provider instance is no longer available on this device.";

export function sideChatComposerStatus(input: {
  readonly shellExists: boolean;
  readonly openingStatus: OrchestrationV2SideChatOpening["status"] | null;
  readonly runActive: boolean;
  /**
   * Why Send is blocked on the side chat's own provider, with the provider list loaded:
   * its instance was removed, or it is off or not ready.
   */
  readonly providerUnavailable: "missing" | "unavailable" | null;
  readonly blockedReason?: string | null;
}):
  | "Starting side chat…"
  | "Preparing context…"
  | typeof SIDE_CHAT_PROVIDER_UNAVAILABLE
  | typeof SIDE_CHAT_PROVIDER_MISSING
  | string
  | null {
  if (!input.shellExists) return "Starting side chat…";
  if (input.openingStatus === "pending" && input.runActive) return "Preparing context…";
  if (input.providerUnavailable === "missing") return SIDE_CHAT_PROVIDER_MISSING;
  if (input.providerUnavailable === "unavailable") return SIDE_CHAT_PROVIDER_UNAVAILABLE;
  if (input.blockedReason) return input.blockedReason;
  return null;
}

/** The lesson citation a side chat was opened from, as a snippet for the side chat's composer. */
export function sideChatAnchorCitation(
  environmentId: EnvironmentId,
  anchor: OrchestrationV2SideChatAnchor,
  excerpt: string,
): AssistantCitation {
  return {
    version: 1,
    environmentId,
    threadId: anchor.threadId,
    messageId: anchor.messageId,
    text: excerpt,
    start: anchor.start,
    end: anchor.end,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
  };
}

/** The first side chat whose AI waits for an approval or an answer. */
export function sideChatAwaitingInput(
  shells: ReadonlyArray<
    Pick<EnvironmentThreadShell, "id" | "sideChat" | "hasPendingApprovals" | "hasPendingUserInput">
  >,
): ThreadId | null {
  const waiting = shells.find(
    (shell) => shell.sideChat != null && (shell.hasPendingApprovals || shell.hasPendingUserInput),
  );
  return waiting?.id ?? null;
}

export function appendComposerSnippet(prompt: string, text: string): string {
  if (prompt === "" || /\s$/.test(prompt)) return `${prompt}${text}`;
  return `${prompt} ${text}`;
}

/** An open side chat the user never wrote to is finished when its tab closes, so it leaves no empty mark behind. */
export function shouldFinishSideChatOnClose(
  shell: Pick<EnvironmentThreadShell, "sideChat" | "latestUserMessageAt"> | null,
): boolean {
  return shell?.sideChat?.state === "open" && shell.latestUserMessageAt === null;
}

/** Shown in the lesson while its run waits for a direct side chat's note. */
export function lessonSideChatWaitLabel(input: {
  readonly lessonThreadId: ThreadId;
  readonly activityRunStatus: OrchestrationV2Run["status"] | null;
  readonly shells: ReadonlyArray<Pick<EnvironmentThreadShell, "sideChat">>;
}): "Adding side-chat note…" | null {
  if (input.activityRunStatus !== "starting") return null;
  const writingNote = input.shells.some(
    (shell) =>
      shell.sideChat?.anchor.threadId === input.lessonThreadId &&
      shell.sideChat.noteStatus === "generating",
  );
  return writingNote ? "Adding side-chat note…" : null;
}
