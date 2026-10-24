import type { LegendListRef } from "@legendapp/list/react";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  deriveSideChatTree,
  type SideChatTreeRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  type AssistantCitation,
  AuthOrchestrationOperateScope,
  type MessageId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { assistantCitationLabel } from "@t3tools/shared/assistantCitations";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, EllipsisIcon, ShieldIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import {
  AssistantCitationRevealContext,
  assistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";
import { observeResize } from "../../lib/observeResize";
import { cn, randomUUID } from "../../lib/utils";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  type SideChatSurface,
  sideChatSurfaceTopThreadId,
  useRightPanelStore,
} from "../../rightPanelStore";
import { isLatestRunSettled } from "../../session-logic";
import {
  useProject,
  useQuietThreadProjection,
  useQuietThreadShell,
  useSideChatNoteDelivered,
  useSideChatTreeShells,
} from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { ChatMessage } from "../../types";
import type { AssistantCitationRequest } from "../chat/AssistantCitationSource";
import type { ChatComposerHandle } from "../chat/ChatComposer";
import { ComposerBanner } from "../chat/ComposerBanner";
import {
  eventPathContainsSelector,
  pasteTextToFocusComposer,
  shouldTypeToFocusComposer,
  TYPE_TO_FOCUS_EDITABLE_SELECTOR,
} from "../chat/composerFocusRedirect";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "../chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "../chat/ComposerPendingUserInputPanel";
import { createPageScrollController } from "../chat/pageScrollController";
import { usePendingThreadRequests } from "../chat/usePendingThreadRequests";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { askInSideChat } from "./openSideChat";
import { usePendingSideChatStore, selectStartingSideChat } from "./pendingSideChatStore";
import { SideChatComposer, type SideChatComposerHandle } from "./SideChatComposer";
import { SideChatExcerpt } from "./SideChatExcerpt";
import { leaveSideChat, revealSideChat, showLesson } from "./sideChatNavigation";
import {
  type SideChatCrumb,
  sideChatAnchorCitation,
  sideChatBreadcrumb,
  shouldFinishSideChatOnClose,
  sideChatStatusLine,
  sideChatSurfacePath,
  topSideChatId,
} from "./sideChatPanel.logic";
import { SideChatTimeline } from "./SideChatTimeline";

const NO_PROVIDERS: Parameters<typeof deriveProviderInstanceEntries>[0] = [];
const NO_MESSAGES: ReadonlyArray<ChatMessage> = [];

/** A side chat in the lesson's right panel, walked in place through its nested side chats. */
export function SideChatPanel(props: {
  readonly lessonRef: ScopedThreadRef;
  readonly surface: SideChatSurface;
  readonly visible: boolean;
  readonly onFocusLesson: () => void;
}) {
  const { lessonRef, surface } = props;
  const environmentId = lessonRef.environmentId;
  const sideChatRef = scopeThreadRef(environmentId, ThreadId.make(surface.threadId));
  const sideChatKey = scopedThreadKey(sideChatRef);
  const navigate = useNavigate();

  const shell = useQuietThreadShell(sideChatRef);
  const detailRef = shell === null ? null : sideChatRef;
  const projection = useQuietThreadProjection(detailRef)?.projection ?? null;
  const detail = projection?.thread.sideChat;
  const treeShells = useSideChatTreeShells(lessonRef);
  const rows = deriveSideChatTree(treeShells, lessonRef.threadId);
  const pending = usePendingSideChatStore((state) => state.byThreadKey[sideChatKey]);
  const askPending = usePendingSideChatStore((state) =>
    selectStartingSideChat(state, scopedThreadKey(lessonRef)),
  );
  const focusRequested = usePendingSideChatStore((state) => state.focusThreadKey === sideChatKey);
  // The lesson forgets a pending side chat once its shell lands, before the detail with its
  // excerpt loads. Holding the asked citation for that gap keeps the excerpt from blinking out.
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly citation: AssistantCitation;
  } | null>(null);
  if (pending !== undefined) {
    if (held?.key !== sideChatKey || held.citation !== pending.citation) {
      setHeld({ key: sideChatKey, citation: pending.citation });
    }
  } else if (held !== null && (held.key !== sideChatKey || detail !== undefined)) {
    setHeld(null);
  }
  const heldCitation = held?.key === sideChatKey ? held.citation : null;
  const citation =
    shell?.sideChat && detail
      ? sideChatAnchorCitation(environmentId, shell.sideChat.anchor, detail.excerpt)
      : (pending?.citation ?? heldCitation);
  const crumbs =
    shell === null && pending !== undefined
      ? startingBreadcrumb(rows, pending.citation.threadId, {
          threadId: pending.threadId,
          label: assistantCitationLabel(pending.citation),
          role: "current",
        })
      : sideChatBreadcrumb(rows, surface.threadId, surface.trail);

  const crumbsRef = useRef<HTMLDivElement>(null);
  const crumbsKey = crumbs.map((crumb) => `${crumb.role}:${crumb.threadId}`).join(" ");
  useEffect(() => {
    const trail = crumbsRef.current;
    if (trail === null) return;
    // The trail narrows when Done and the menu arrive after an Ask, and with the panel or
    // window, which leaves the crumb it had scrolled to under the fade. A crumb with focus
    // stays in view rather than the current one.
    const scrollIntoView = () => {
      const crumb =
        trail.querySelector("button:focus") ?? trail.querySelector("[aria-current='page']");
      crumb?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    scrollIntoView();
    return observeResize(trail, scrollIntoView);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new path or current crumb re-renders the crumbs, so the current one scrolls back into view.
  }, [crumbsKey]);

  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const loadedProviders = useEnvironmentProviders().get(environmentId);
  const providers = loadedProviders ?? NO_PROVIDERS;
  const providerEntry =
    shell === null
      ? undefined
      : deriveProviderInstanceEntries(providers).find(
          (entry) => entry.instanceId === shell.modelSelection.instanceId,
        );
  const project = useProject(
    shell === null ? null : scopeProjectRef(environmentId, shell.projectId),
  );
  const workspaceRoot = shell?.worktreePath ?? project?.workspaceRoot ?? undefined;
  const activityRun = projection === null ? null : deriveThreadActivityRun(projection);
  const runtime = projection === null ? null : deriveThreadStructureRuntime(projection);
  const runActive = activityRun !== null && !isLatestRunSettled(activityRun, runtime);

  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  // The hook writes the pending answer here; the side chat's draft stays apart from it.
  const answerPromptRef = useRef("");
  // No ChatComposer renders here; the hook only resets its cursor through this.
  const chatComposerRef = useRef<ChatComposerHandle | null>(null);
  const {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingIsResponding,
    respondingRequestIds,
    onRespondToApproval,
    onDismissUserInput,
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInputStable,
  } = usePendingThreadRequests({
    environmentId,
    activeThreadId: shell?.id ?? null,
    activeThread: shell ?? undefined,
    serverProjection: projection,
    supportsQuestionAttachments: false,
    composerDraftTarget: sideChatRef,
    setComposerDraftPrompt,
    promptRef: answerPromptRef,
    composerRef: chatComposerRef,
    setThreadError: (_threadId, error) => {
      if (error !== null) toastManager.add(stackedThreadToast({ type: "error", title: error }));
    },
  });

  // Rows this panel sent, until the server's messages carry them. Walking to another
  // side chat starts with none.
  const [optimistic, setOptimistic] = useState<{
    readonly key: string;
    readonly messages: ReadonlyArray<ChatMessage>;
  }>({ key: sideChatKey, messages: NO_MESSAGES });
  if (optimistic.key !== sideChatKey) setOptimistic({ key: sideChatKey, messages: NO_MESSAGES });
  const serverMessageIds = new Set<string>(projection?.messages.map((message) => message.id));
  const optimisticMessages = optimistic.messages.some((message) => serverMessageIds.has(message.id))
    ? optimistic.messages.filter((message) => !serverMessageIds.has(message.id))
    : optimistic.messages;

  const [citationRequest, setCitationRequest] = useState<AssistantCitationRequest | null>(null);
  // A reveal belongs to the walk that made it; walking back to its thread later must not replay it.
  if (citationRequest !== null && citationRequest.citation.threadId !== surface.threadId) {
    setCitationRequest(null);
  }
  const listRef = useRef<LegendListRef | null>(null);
  const composerHandleRef = useRef<SideChatComposerHandle | null>(null);
  const pageScrollRef = useRef<ReturnType<typeof createPageScrollController> | null>(null);
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => listRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => 0,
    });
    pageScrollRef.current = controller;
    return () => {
      controller.dispose();
      if (pageScrollRef.current === controller) pageScrollRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!props.visible || !focusRequested) return;
    composerHandleRef.current?.focusAtEnd();
    usePendingSideChatStore.getState().clearFocus(sideChatKey);
  }, [props.visible, focusRequested, sideChatKey]);

  const finish = useOrchestrationCommand(threadEnvironment.finishSideChat, {
    reportFailure: false,
  });
  const openSideChat = useOrchestrationCommand(threadEnvironment.openSideChat, {
    reportFailure: false,
  });

  const reportFinish = async (discard: boolean) => {
    const threadId = sideChatRef.threadId;
    const deletes = discard || shouldFinishSideChatOnClose(shell);
    const result = await finish({
      environmentId,
      input: discard ? { threadId, discard: true } : { threadId },
    });
    if (result._tag === "Success") {
      // The server deleted the side chat, so nothing can reach its draft again.
      if (deletes) useComposerDraftStore.getState().clearComposerContent(sideChatRef);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn't finish the side chat",
        description: error instanceof Error ? error.message : undefined,
      }),
    );
  };
  // The note is written in the background, so the panel moves on without waiting for it.
  const finishSideChat = (discard: boolean) => {
    void reportFinish(discard);
    return leaveSideChat(lessonRef, surface, rows);
  };
  // The menu refocuses a clicked item, then its trigger once it closes; a closed tab takes
  // both away, so the menu hands focus to the lesson as it closes.
  const discardClosedTabRef = useRef(false);

  const walkTo = (threadId: string) =>
    useRightPanelStore
      .getState()
      .navigateSideChat(
        lessonRef,
        surface.id,
        sideChatSurfacePath(rows, threadId),
        sideChatSurfacePath(rows, surface.threadId),
      );

  // The tag or link that opened a nested side chat goes away with the walk and leaves
  // focus nowhere, so the side chat's composer takes it. A crumb stays and keeps it.
  const walkInto = (threadId: ThreadId) => {
    walkTo(threadId);
    usePendingSideChatStore
      .getState()
      .requestFocus(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  };

  const onCrumb = (crumb: SideChatCrumb) => {
    if (crumb.role === "lesson") {
      props.onFocusLesson();
      return;
    }
    if (crumb.role !== "current") walkTo(crumb.threadId);
  };

  /** Shows a citation of one of the lesson's side chats here; false for any other thread. */
  const revealCitation = (target: AssistantCitation): boolean => {
    const top =
      target.environmentId === environmentId ? topSideChatId(rows, target.threadId) : null;
    if (top === null) return false;
    if (top !== sideChatSurfaceTopThreadId(surface)) {
      revealSideChat(lessonRef, target.threadId);
      return true;
    }
    // Walking to the side chat already shown would drop its trail back down.
    if (target.threadId !== surface.threadId) walkTo(target.threadId);
    setCitationRequest({ citation: target, key: randomUUID() });
    return true;
  };

  const reveal = () => {
    if (citation === null || revealCitation(citation)) return;
    // A maximized panel or a sheet would hide the highlight the lesson scrolls to.
    showLesson(lessonRef, window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).matches);
    // Only the hash changes, so the lesson stays mounted and scrolls to the highlight.
    void navigate({ ...assistantCitationNavigation(citation), replace: true });
  };

  const onOpenThread = (threadId: ThreadId) => {
    const top = topSideChatId(rows, threadId);
    if (top === sideChatSurfaceTopThreadId(surface)) {
      walkInto(threadId);
      return;
    }
    // A side chat under another top-level one opens in that side chat's own tab.
    if (top !== null) {
      revealSideChat(lessonRef, threadId);
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  const sideChat = shell?.sideChat ?? undefined;
  const sideChatState = sideChat?.state;
  const outcome = detail?.done?.outcome;
  const parentRow =
    sideChat === undefined
      ? undefined
      : rows.find((row) => row.threadId === sideChat.anchor.threadId);
  const noteDelivered = useSideChatNoteDelivered(
    sideChat?.noteStatus === "ready" && outcome !== undefined
      ? scopeThreadRef(environmentId, sideChat.anchor.threadId)
      : null,
    sideChatRef.threadId,
    outcome?.requestId ?? "",
  );
  const statusLine = sideChatStatusLine(sideChat, outcome?.note ?? null, {
    label: parentRow === undefined || parentRow.state === "lesson" ? null : parentRow.label,
    delivered: noteDelivered,
  });
  const answeringPendingUserInput = activePendingProgress !== null;

  return (
    <SideChatPanelContexts revealCitation={revealCitation}>
      <section
        data-side-chat-panel
        tabIndex={-1}
        aria-label="Side chat"
        className="flex h-full min-h-0 flex-col outline-none"
        onKeyDown={(event) => {
          // Portaled popups bubble their keys here through React; only the panel's own count.
          if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) {
            return;
          }
          // An editable keeps the key to scroll itself, such as a long draft. The composer
          // hands the timeline only the keys its draft can't use, via onPageScrollKeyDown.
          if (
            (event.key === "PageUp" || event.key === "PageDown") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !eventPathContainsSelector(event.nativeEvent, TYPE_TO_FOCUS_EDITABLE_SELECTOR)
          ) {
            event.preventDefault();
            pageScrollRef.current?.handleKeyDown(event.key);
            return;
          }
          if (
            shouldTypeToFocusComposer(event.nativeEvent, "side-chat") &&
            composerHandleRef.current?.insertTextAtEnd(event.key) === true
          ) {
            event.preventDefault();
          }
        }}
        onKeyUp={(event) => pageScrollRef.current?.handleKeyUp(event.key)}
        onPaste={(event) => {
          const text = pasteTextToFocusComposer(event.nativeEvent, "side-chat");
          if (text !== null && composerHandleRef.current?.insertTextAtEnd(text) === true) {
            event.preventDefault();
          }
        }}
      >
        <header className="flex min-h-9 shrink-0 items-center gap-1 border-b border-border px-2">
          <nav aria-label="Side chat path" className="min-w-0 flex-1">
            <ScrollArea ref={crumbsRef} radius="none" hideScrollbars scrollFade>
              <ol className="flex w-max min-w-full items-center gap-0.5 text-xs">
                {crumbs.map((crumb, index) => (
                  <li key={crumb.threadId} className="flex shrink-0 items-center gap-0.5">
                    {index === 0 ? null : (
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    )}
                    <button
                      type="button"
                      aria-current={crumb.role === "current" ? "page" : undefined}
                      className={cn(
                        "block max-w-40 cursor-pointer truncate rounded-sm px-1 py-0.5 text-left outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        crumb.role === "current"
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => onCrumb(crumb)}
                      // Chrome leaves a partly visible element where it is on focus, so a
                      // crumb under the fade would take the cursor out of sight.
                      onFocus={(event) =>
                        event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })
                      }
                    >
                      {crumb.label}
                    </button>
                  </li>
                ))}
              </ol>
            </ScrollArea>
          </nav>
          {sideChatState === "open" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canOperate}
              onClick={() => {
                // A closed tab takes this button with it, so the cursor goes back to the lesson.
                if (finishSideChat(false) === "closed") props.onFocusLesson();
              }}
            >
              Done
            </Button>
          ) : null}
          {shell === null ? null : (
            <Menu>
              <MenuTrigger
                disabled={!canOperate}
                render={
                  <Button size="icon-xs" variant="ghost" aria-label="More side chat actions" />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup
                align="end"
                finalFocus={() => {
                  if (!discardClosedTabRef.current) return true;
                  props.onFocusLesson();
                  return false;
                }}
              >
                <MenuItem
                  variant="destructive"
                  onClick={() => {
                    discardClosedTabRef.current = finishSideChat(true) === "closed";
                  }}
                >
                  Discard
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
        </header>
        {citation === null ? null : (
          <div className="shrink-0 px-3 pt-2">
            <SideChatExcerpt text={citation.text} onReveal={reveal} />
          </div>
        )}
        <div className="min-h-0 flex-1">
          <SideChatTimeline
            lessonRef={lessonRef}
            sideChatRef={sideChatRef}
            detailRef={detailRef}
            projection={projection}
            // A side chat this panel just started has nothing to load yet.
            detailLoading={detailRef !== null && projection === null && heldCitation === null}
            optimisticMessages={optimisticMessages}
            listRef={listRef}
            citationRequest={citationRequest}
            askInSideChatPending={askPending}
            onCiteAssistantText={(cited, sourceAnchor) =>
              composerHandleRef.current?.citeAssistantText(cited, sourceAnchor) ?? false
            }
            onAskInSideChat={
              canOperate
                ? (asked) =>
                    askInSideChat({
                      lessonRef,
                      citation: asked,
                      sideChatShells: treeShells,
                      topThreadId: sideChatSurfaceTopThreadId(surface),
                      run: openSideChat,
                    })
                : undefined
            }
            onOpenThread={onOpenThread}
            onOpenSideChat={walkInto}
            workspaceRoot={workspaceRoot}
          />
        </div>
        <p role="status" className="shrink-0 px-3 pt-2 text-muted-foreground text-xs empty:hidden">
          {statusLine}
        </p>
        {activePendingApproval ? (
          <ComposerBanner.Root
            placement="floating"
            variant="warning"
            density="spacious"
            className="mx-2 mt-2 shrink-0"
          >
            <ComposerBanner.Row layout="approval">
              <ComposerBanner.Icon>
                <ShieldIcon />
              </ComposerBanner.Icon>
              <ComposerBanner.Content>
                <ComposerPendingApprovalPanel
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                />
              </ComposerBanner.Content>
              <ComposerBanner.Actions>
                <ComposerPendingApprovalActions
                  requestId={activePendingApproval.requestId}
                  disabled={!canOperate}
                  isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                  options={activePendingApproval.options}
                  canRespond={activePendingApproval.responseCapability === "live"}
                  onRespondToApproval={onRespondToApproval}
                />
              </ComposerBanner.Actions>
            </ComposerBanner.Row>
          </ComposerBanner.Root>
        ) : pendingUserInputs.length > 0 ? (
          <ComposerBanner.Root placement="floating" variant="info" className="mx-2 mt-2 shrink-0">
            <ComposerPendingUserInputPanel
              pendingUserInputs={pendingUserInputs}
              cwd={workspaceRoot}
              threadRef={sideChatRef}
              disabled={!canOperate}
              respondingRequestIds={
                activePendingIsResponding && activePendingUserInput
                  ? [...respondingRequestIds, activePendingUserInput.requestId]
                  : respondingRequestIds
              }
              answers={activePendingDraftAnswers}
              questionIndex={activePendingQuestionIndex}
              onToggleOption={onSelectActivePendingUserInputOption}
              onAdvance={onAdvanceActivePendingUserInputStable}
              onDismiss={onDismissUserInput}
            />
          </ComposerBanner.Root>
        ) : null}
        <SideChatComposer
          sideChatRef={sideChatRef}
          shell={shell}
          providerEntry={providerEntry}
          providerCatalogKnown={loadedProviders !== undefined}
          openingStatus={detail?.opening.status ?? null}
          runActive={runActive}
          answeringPendingUserInput={answeringPendingUserInput}
          handleRef={composerHandleRef}
          onAdvancePendingUserInput={onAdvanceActivePendingUserInputStable}
          pendingUserInputCustomAnswer={activePendingProgress?.customAnswer}
          onPendingUserInputCustomAnswerChange={(value) => {
            const questionId = activePendingProgress?.activeQuestion?.id;
            if (questionId !== undefined)
              onChangeActivePendingUserInputCustomAnswer(questionId, value);
          }}
          onOptimisticMessage={(message) =>
            setOptimistic((current) => ({
              key: sideChatKey,
              messages: [...(current.key === sideChatKey ? current.messages : []), message],
            }))
          }
          onOptimisticMessageFailed={(messageId: MessageId) =>
            setOptimistic((current) => ({
              ...current,
              messages: current.messages.filter((message) => message.id !== messageId),
            }))
          }
          onPageScrollKeyDown={(key) => pageScrollRef.current?.handleKeyDown(key)}
          onPageScrollKeyUp={(key) => pageScrollRef.current?.handleKeyUp(key)}
          onPageScrollRelease={() => pageScrollRef.current?.releaseActiveKey()}
        />
      </section>
    </SideChatPanelContexts>
  );
}

/** Keeps the lesson's composer out of the panel, and reveals cited side chats in it. */
function SideChatPanelContexts(props: {
  readonly revealCitation: (citation: AssistantCitation) => boolean;
  readonly children: ReactNode;
}) {
  return (
    <ComposerHandleContext value={null}>
      <AssistantCitationRevealContext value={props.revealCitation}>
        {props.children}
      </AssistantCitationRevealContext>
    </ComposerHandleContext>
  );
}

/**
 * The crumbs of a side chat whose shell has not arrived: the path to the thread it
 * was asked from, then the new side chat itself.
 */
function startingBreadcrumb(
  rows: ReadonlyArray<SideChatTreeRow>,
  anchorThreadId: string,
  current: SideChatCrumb,
): ReadonlyArray<SideChatCrumb> {
  return [
    ...sideChatBreadcrumb(rows, anchorThreadId, undefined).map((crumb) =>
      crumb.role === "current" ? { ...crumb, role: "ancestor" as const } : crumb,
    ),
    current,
  ];
}
