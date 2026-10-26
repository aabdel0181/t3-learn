import type { LegendListRef } from "@legendapp/list/react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import {
  deriveLatestThreadRun,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import type { AssistantCitation, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { deriveActiveWorkStartedAt, derivePhase, isLatestRunSettled } from "../../session-logic";
import type { ChatMessage } from "../../types";
import type { AssistantCitationRequest } from "../chat/AssistantCitationSource";
import { openExpandedImagePreview } from "../chat/ExpandedImageDialog";
import { ThreadTimeline } from "../chat/ThreadTimeline";

const noop = () => {};

/**
 * A side chat's timeline in the lesson's panel. It stays out of the held-timeline
 * cache and offers none of the lesson's thread actions (fork, rollback, revert,
 * turn diffs, worktree setup, artifact templates, app messages).
 */
export function SideChatTimeline(props: {
  readonly lessonRef: ScopedThreadRef;
  readonly sideChatRef: ScopedThreadRef;
  /** Null until the side chat's detail may load. */
  readonly detailRef: ScopedThreadRef | null;
  readonly projection: ThreadStructure | null;
  /** The highlight the side chat is about; null until known. */
  readonly label: string | null;
  readonly detailLoading: boolean;
  readonly optimisticMessages: ReadonlyArray<ChatMessage>;
  readonly listRef: React.RefObject<LegendListRef | null>;
  readonly citationRequest: AssistantCitationRequest | null;
  readonly askInSideChatPending: boolean;
  readonly onCiteAssistantText: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
  /** Undefined when the connection cannot operate the thread. */
  readonly onAskInSideChat:
    | ((citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** Opens a side chat nested in this one from its mark. */
  readonly onOpenSideChat?: (threadId: ThreadId) => void;
  readonly workspaceRoot: string | undefined;
}) {
  const { projection, workspaceRoot } = props;
  const sideChatKey = scopedThreadKey(props.sideChatRef);
  const lessonKey = scopedThreadKey(props.lessonRef);
  const { resolvedTheme } = useTheme();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);

  // Run state as ChatView derives it for a server thread.
  const latestRun = projection === null ? null : deriveLatestThreadRun(projection);
  const activityRun = projection === null ? null : deriveThreadActivityRun(projection);
  const runtime = projection === null ? null : deriveThreadStructureRuntime(projection);
  const runlessWorkStartedAt = projection === null ? null : deriveRunlessWorkStartedAt(projection);
  const isWorking = derivePhase(runtime) === "running" || runlessWorkStartedAt !== null;

  return (
    <div className="h-full min-h-0">
      <ThreadTimeline
        holdTimeline={false}
        threadDetailRef={props.detailRef}
        entriesInput={{
          optimisticMessages: props.optimisticMessages,
          ...(projection === null
            ? {}
            : { attempts: projection.attempts, nodes: projection.nodes, plans: projection.plans }),
        }}
        draftEntries={null}
        activeThreadKey={sideChatKey}
        syncing={props.detailLoading}
        detailLoading={props.detailLoading}
        readyMarkdownCwd={workspaceRoot ?? null}
        readyWorkspaceRoot={workspaceRoot ?? null}
        citationRequest={props.citationRequest}
        citationHistoryLoading={props.detailLoading}
        onCiteAssistantText={props.onCiteAssistantText}
        onAskInSideChat={props.onAskInSideChat}
        askInSideChatPending={props.askInSideChatPending}
        isWorking={isWorking}
        runlessWorkActive={runlessWorkStartedAt !== null}
        activeTurnInProgress={isWorking || !isLatestRunSettled(latestRun, runtime)}
        activeTurnStartedAt={
          deriveActiveWorkStartedAt(activityRun, runtime, null) ?? runlessWorkStartedAt
        }
        onCancelWorktreeSetup={noop}
        listRef={props.listRef}
        runs={projection?.runs ?? []}
        latestRun={activityRun}
        runningRunId={runtime?.activeRunId ?? null}
        turnDiffSummaries={[]}
        activeThreadEnvironmentId={props.sideChatRef.environmentId}
        routeThreadKey={sideChatKey}
        onOpenTurnDiff={noop}
        onOpenThread={props.onOpenThread}
        {...(props.onOpenSideChat === undefined ? {} : { onOpenSideChat: props.onOpenSideChat })}
        onRollbackCheckpoint={noop}
        supportsConversationRollback={false}
        onRevertToTurnCount={noop}
        isRevertingCheckpoint={false}
        onImageExpand={(preview) => openExpandedImagePreview(lessonKey, preview)}
        markdownCwd={workspaceRoot}
        resolvedTheme={resolvedTheme}
        timestampFormat={timestampFormat}
        workspaceRoot={workspaceRoot}
        anchorMessageId={null}
        onAnchorReady={noop}
        onAnchorSizeChanged={noop}
        contentInsetEndAdjustment={0}
        liveFollowEnabled
        onIsAtEndChange={noop}
        onManualNavigation={noop}
        hideEmptyPlaceholder={props.detailLoading}
        emptyPlaceholder={
          props.label === null ? undefined : (
            // The question is the side chat's only prompt to type, so it reads at full muted strength.
            <span className="text-muted-foreground">
              What do you want to know about “{props.label}”?
            </span>
          )
        }
        emptyPlaceholderInset={0}
      />
    </div>
  );
}
