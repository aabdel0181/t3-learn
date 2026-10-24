import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  type AssistantCitation,
  AuthOrchestrationOperateScope,
  type MessageId,
  type OrchestrationV2SideChatOpening,
  type ScopedThreadRef,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { useImperativeHandle, useRef, useState } from "react";

import {
  collapseExpandedComposerCursor,
  composerSubmissionIntentForKey,
  formatAssistantCitationForComposer,
  replaceTextRange,
} from "../../composer-logic";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useSoftwareKeyboardOpen } from "../../hooks/useSoftwareKeyboardOpen";
import type { AssistantCitationSourceAnchor } from "../../lib/assistantTextSelection";
import { newMessageId } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import {
  ORCHESTRATION_OPERATE_DENIED_MESSAGE,
  useOrchestrationCommand,
} from "../../state/use-orchestration-command";
import type { ChatMessage } from "../../types";
import { draftSendState } from "../chat/chatViewSend";
import { ComposerPromptLengthValidation } from "../chat/ComposerPromptLengthValidation";
import { planSideChatSend, type SideChatSendPlan } from "../chat/composerSend.logic";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { appendComposerSnippet, sideChatComposerStatus } from "./sideChatPanel.logic";

export interface SideChatComposerHandle {
  readonly focusAtEnd: () => void;
  readonly insertTextAtEnd: (text: string) => boolean;
  readonly citeAssistantText: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
}

const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];

function sendBlockedDescription(plan: SideChatSendPlan): string | undefined {
  if (plan._tag !== "Blocked") return undefined;
  switch (plan.reason) {
    case "starting":
      return "Starting side chat…";
    case "run-active":
      return "Wait for this answer to finish";
    case "provider-unavailable":
      return "This side chat's provider is unavailable";
    case "no-operate-scope":
      return ORCHESTRATION_OPERATE_DENIED_MESSAGE;
    case "in-flight":
    case "empty":
      return undefined;
  }
}

/**
 * The side chat's composer: text and quotes only, so no attachments, slash commands,
 * model picker or interaction-mode toggle. It sends with the side chat's own model and modes.
 */
export function SideChatComposer(props: {
  readonly sideChatRef: ScopedThreadRef;
  /** Null while the side chat is starting. */
  readonly shell: EnvironmentThreadShell | null;
  readonly providerEntry: ProviderInstanceEntry | undefined;
  /** The environment's providers have loaded, so a missing entry means the provider is gone. */
  readonly providerCatalogKnown: boolean;
  readonly openingStatus: OrchestrationV2SideChatOpening["status"] | null;
  readonly runActive: boolean;
  readonly answeringPendingUserInput: boolean;
  readonly handleRef: React.RefObject<SideChatComposerHandle | null>;
  readonly onAdvancePendingUserInput: () => void;
  /** The pending question's custom answer, shown in the editor while answering. */
  readonly pendingUserInputCustomAnswer?: string | undefined;
  readonly onPendingUserInputCustomAnswerChange?:
    | ((value: string, cursor: number) => void)
    | undefined;
  readonly onOptimisticMessage: (message: ChatMessage) => void;
  readonly onOptimisticMessageFailed: (messageId: MessageId) => void;
  readonly onPageScrollKeyDown: (key: "PageUp" | "PageDown") => void;
  readonly onPageScrollKeyUp: (key: string) => void;
  readonly onPageScrollRelease: () => void;
}) {
  const { sideChatRef, shell, providerEntry, runActive, answeringPendingUserInput } = props;
  const sideChatKey = scopedThreadKey(sideChatRef);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const draftPrompt = useComposerThreadDraft(sideChatRef).prompt;
  // While a question is pending the editor holds its answer, apart from the side chat's draft.
  const answer = answeringPendingUserInput ? (props.pendingUserInputCustomAnswer ?? "") : null;
  const prompt = answer ?? draftPrompt;
  // The editor's caret, kept per side chat and per text so a new one opens at its end.
  const caretKey = answer === null ? sideChatKey : `${sideChatKey}:answer`;
  const [caret, setCaret] = useState<{ readonly key: string; readonly cursor: number } | null>(
    null,
  );
  const cursor =
    caret?.key === caretKey ? caret.cursor : collapseExpandedComposerCursor(prompt, prompt.length);
  // The send-state ref dedupes across remounts; this state re-renders the button.
  const [sending, setSending] = useState(false);
  const canOperate = useEnvironmentScope(sideChatRef.environmentId, AuthOrchestrationOperateScope);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sendShortcut = useEnvironmentSettings(
    sideChatRef.environmentId,
    (settings) => settings.sendShortcut,
  );
  const isSoftwareKeyboardOpen = useSoftwareKeyboardOpen();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  const readDraft = () =>
    useComposerDraftStore.getState().getComposerDraft(sideChatRef)?.prompt ?? "";
  const writeDraft = (next: string, expandedCursor: number) => {
    useComposerDraftStore.getState().setPrompt(sideChatRef, next);
    setCaret({ key: sideChatKey, cursor: collapseExpandedComposerCursor(next, expandedCursor) });
  };
  // The editor's text: the pending answer while answering, the side chat's draft otherwise.
  const readPrompt = () => answer ?? readDraft();
  const writePrompt = (next: string, expandedCursor: number) => {
    if (answer === null) {
      writeDraft(next, expandedCursor);
      return;
    }
    const nextCursor = collapseExpandedComposerCursor(next, expandedCursor);
    props.onPendingUserInputCustomAnswerChange?.(next, nextCursor);
    setCaret({ key: caretKey, cursor: nextCursor });
  };
  const planSend = (input: { readonly sendInFlight: boolean; readonly prompt: string }) =>
    planSideChatSend({
      canOperate,
      sendInFlight: input.sendInFlight,
      shellReady: shell !== null,
      answeringPendingUserInput,
      providerEntry,
      model: shell?.modelSelection.model ?? "",
      runActive,
      prompt: input.prompt,
    });

  const send = async () => {
    const { sendInFlight } = draftSendState(sideChatKey);
    const text = readDraft();
    const plan = planSend({ sendInFlight: sendInFlight.current, prompt: text });
    if (plan._tag === "AnswerPendingInput") {
      props.onAdvancePendingUserInput();
      return;
    }
    if (plan._tag !== "Ready" || shell === null) return;

    sendInFlight.current = true;
    setSending(true);
    const messageId = newMessageId();
    const createdAt = new Date().toISOString();
    props.onOptimisticMessage({
      id: messageId,
      role: "user",
      ...plan.message,
      runId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    });
    writeDraft("", 0);
    const result = await startTurn({
      environmentId: sideChatRef.environmentId,
      input: {
        threadId: sideChatRef.threadId,
        message: { messageId, role: "user", attachments: [], ...plan.message },
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        createdAt,
      },
    });
    sendInFlight.current = false;
    setSending(false);
    if (result._tag === "Success") return;

    props.onOptimisticMessageFailed(messageId);
    // Text typed while the send was in flight stays; the failed row still shows the message.
    if (readDraft() === "") writeDraft(text, text.length);
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn't send to the side chat",
        description: error instanceof Error ? error.message : undefined,
      }),
    );
  };

  useImperativeHandle(props.handleRef, () => ({
    focusAtEnd: () => editorRef.current?.focusAtEnd(),
    insertTextAtEnd: (text) => {
      if (text === "") return false;
      const next = `${readPrompt()}${text}`;
      writePrompt(next, next.length);
      // The new value lands on the next render, which moves the caret to its end.
      editorRef.current?.focus();
      return true;
    },
    citeAssistantText: (citation, sourceAnchor) => {
      const editor = editorRef.current;
      if (!editor) return false;
      const current = readPrompt();
      const snippet = formatAssistantCitationForComposer(citation, citation.comment);
      const next = appendComposerSnippet(current, snippet);
      const citationStart = next.length - snippet.length;
      editor.requestCitationComment({
        previousValue: current,
        value: next,
        citationStart,
        sourceAnchor,
        insertedSpaces: { before: citationStart > current.length, after: true },
      });
      writePrompt(next, next.length);
      return true;
    },
  }));

  const plan = planSend({ sendInFlight: sending, prompt });
  const status = sideChatComposerStatus({
    shellExists: shell !== null,
    openingStatus: props.openingStatus,
    runActive,
    providerUnavailable:
      props.providerCatalogKnown &&
      plan._tag === "Blocked" &&
      plan.reason === "provider-unavailable",
  });

  return (
    <div className="border-t border-border">
      {status === null ? null : <p className="px-3 pt-2 text-muted-foreground text-xs">{status}</p>}
      <div className="flex items-end gap-2 px-3 py-2">
        <ComposerPromptEditor
          draftKey={sideChatKey}
          ariaLabel="Side chat message"
          placeholder="Ask a follow-up…"
          editorRef={editorRef}
          value={prompt}
          cursor={cursor}
          contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
          skills={NO_SKILLS}
          disabled={false}
          containerClassName="min-w-0 flex-1"
          className="min-h-10"
          onChange={(value, nextCursor) => {
            if (answer === null) useComposerDraftStore.getState().setPrompt(sideChatRef, value);
            else props.onPendingUserInputCustomAnswerChange?.(value, nextCursor);
            setCaret({ key: caretKey, cursor: nextCursor });
          }}
          onCommandKeyDown={(key, event) => {
            if (key !== "Enter") return false;
            const intent = composerSubmissionIntentForKey({
              event,
              keybindings,
              isSoftwareKeyboardOpen,
              isDraftThread: false,
              isRunning: runActive,
              sendShortcut,
              prompt,
            });
            if (intent === null) return false;
            // A side chat has no alternate or background send, so those chords do nothing.
            if (intent === "foreground") void send();
            return true;
          }}
          onPageScrollKeyDown={props.onPageScrollKeyDown}
          onPageScrollKeyUp={props.onPageScrollKeyUp}
          onPageScrollRelease={props.onPageScrollRelease}
          onCitationSubmitAndSend={() => void send()}
          onPaste={(event) => {
            // The editor pastes plain text itself but leaves a clipboard holding files
            // to the browser. Composer v1 has no attachments: keep the text, drop the files.
            if (event.clipboardData.files.length === 0) return;
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            const selection = editorRef.current?.readSelectionRange();
            if (text === "" || !selection) return;
            const next = replaceTextRange(readPrompt(), selection.start, selection.end, text);
            writePrompt(next.text, next.cursor);
          }}
        />
        <Button
          size="icon-sm"
          aria-label="Send side chat message"
          aria-description={sendBlockedDescription(plan)}
          disabled={plan._tag === "Blocked" || plan._tag === "Invalid"}
          onClick={() => void send()}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
      </div>
      <ComposerPromptLengthValidation message={plan._tag === "Invalid" ? plan.message : null} />
    </div>
  );
}
