import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AssistantCitation,
  EnvironmentId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { createRef, useState, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  dispatch: (async () => undefined) as (...args: never) => Promise<unknown>,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => state.dispatch) as never,
}));

vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));

// The real settings and keybindings watch environment connections the test does not serve.
vi.mock(import("../../state/server"), async (importOriginal) => {
  const { Atom } = await import("effect/reactivity");
  const { mergeWithDefaultKeybindings } = await import("@t3tools/shared/keybindings");
  return {
    ...(await importOriginal()),
    primaryServerKeybindingsAtom: Atom.make(mergeWithDefaultKeybindings([])),
  };
});
vi.mock(import("../../hooks/useSettings"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentSettings: ((
    _environmentId: EnvironmentId,
    selector: (settings: { sendShortcut: "enter" }) => unknown,
  ) => selector({ sendShortcut: "enter" })) as never,
}));

import { act, render, type Screen } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import { findAssistantCitationSourceAnchor } from "../../lib/assistantTextSelection";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { makeThreadFixture } from "../../test-fixtures";
import { toastManager } from "../ui/toast";
import { SideChatComposer, type SideChatComposerHandle } from "./SideChatComposer";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const SIDE_CHAT_ID = ThreadId.make("side-1");
const SIDE_CHAT_REF = scopeThreadRef(ENVIRONMENT_ID, SIDE_CHAT_ID);
const CODEX = ProviderInstanceId.make("codex");
const SHELL = makeThreadFixture({ id: SIDE_CHAT_ID, environmentId: ENVIRONMENT_ID });
const PROVIDER_ENTRY = deriveProviderInstanceEntries([
  {
    instanceId: CODEX,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-22T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  },
])[0];
const CITATION: AssistantCitation = {
  version: 1,
  environmentId: ENVIRONMENT_ID,
  threadId: SIDE_CHAT_ID,
  messageId: MessageId.make("side-1-reply"),
  text: "observation space",
  start: 3,
  end: 20,
  prefix: "An ",
  suffix: " is what the agent can see.",
};

function setup(dispatchResult: unknown = AsyncResult.success({ sequence: 1 })) {
  const dispatch = vi.fn(async (_value: unknown) => dispatchResult);
  state.dispatch = dispatch;
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  return dispatch;
}

function composer(props: Partial<ComponentProps<typeof SideChatComposer>> = {}) {
  return (
    <SideChatComposer
      sideChatRef={SIDE_CHAT_REF}
      shell={SHELL}
      providerEntry={PROVIDER_ENTRY}
      providerCatalogKnown
      openingStatus="ready"
      runActive={false}
      answeringPendingUserInput={false}
      handleRef={createRef<SideChatComposerHandle>()}
      onAdvancePendingUserInput={() => {}}
      onOptimisticMessage={() => {}}
      onOptimisticMessageFailed={() => {}}
      onPageScrollKeyDown={() => {}}
      onPageScrollKeyUp={() => {}}
      onPageScrollRelease={() => {}}
      {...props}
    />
  );
}

const draft = () => useComposerDraftStore.getState().getComposerDraft(SIDE_CHAT_REF)?.prompt ?? "";
const editor = (screen: Screen) => screen.getByRole("textbox", { name: "Side chat message" });
const sendButton = (screen: Screen) =>
  screen.getByRole("button", { name: "Send side chat message" });

async function typeQuestion(screen: Screen) {
  await editor(screen).click();
  await userEvent.keyboard("What is a Box?");
}

it("keeps typing in the side chat's draft and holds Send while the side chat starts", async () => {
  const dispatch = setup();
  await using screen = await render(composer({ shell: null }));

  await typeQuestion(screen);

  await expect.element(screen.getByText("Starting side chat…")).toBeVisible();
  await expect.element(sendButton(screen)).toBeDisabled();
  await expect
    .element(sendButton(screen))
    .toHaveAttribute("aria-description", "Starting side chat…");
  await userEvent.keyboard("{Enter}");
  expect(dispatch).not.toHaveBeenCalled();
  expect(draft()).toBe("What is a Box?");
});

it("sends with the side chat's model and modes and no title seed", async () => {
  const dispatch = setup();
  const onOptimisticMessage = vi.fn();
  await using screen = await render(composer({ onOptimisticMessage }));

  await typeQuestion(screen);
  await sendButton(screen).click();

  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId: ENVIRONMENT_ID,
    input: {
      threadId: "side-1",
      message: {
        messageId: expect.any(String),
        role: "user",
        text: "What is a Box?",
        attachments: [],
      },
      modelSelection: { instanceId: CODEX, model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: expect.any(String),
    },
  });
  const sent = dispatch.mock.calls[0]?.[0] as { input: { message: { messageId: MessageId } } };
  expect(onOptimisticMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      id: sent.input.message.messageId,
      role: "user",
      text: "What is a Box?",
    }),
  );
  expect(draft()).toBe("");
});

it("restores the draft when the server refuses the message", async () => {
  setup(AsyncResult.failure(Cause.fail(new Error("The provider is not signed in."))));
  const onOptimisticMessage = vi.fn();
  const onOptimisticMessageFailed = vi.fn();
  await using screen = await render(composer({ onOptimisticMessage, onOptimisticMessageFailed }));
  using toast = vi.spyOn(toastManager, "add").mockReturnValue("toast-1");

  await typeQuestion(screen);
  await sendButton(screen).click();

  await vi.waitFor(() => expect(draft()).toBe("What is a Box?"));
  const [optimistic] = onOptimisticMessage.mock.calls[0] as [{ id: MessageId }];
  expect(onOptimisticMessageFailed).toHaveBeenCalledExactlyOnceWith(optimistic.id);
  expect(toast).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "error",
      title: "Couldn't send to the side chat",
      description: "The provider is not signed in.",
    }),
  );
});

it("blocks a second message while the side chat is still answering", async () => {
  const dispatch = setup();
  await using screen = await render(composer({ runActive: true }));

  await typeQuestion(screen);

  await expect
    .element(sendButton(screen))
    .toHaveAttribute("aria-description", "Wait for this answer to finish");
  await expect.element(sendButton(screen)).toBeDisabled();
  await userEvent.keyboard("{Enter}");
  expect(dispatch).not.toHaveBeenCalled();
  expect(draft()).toBe("What is a Box?");
});

it("says it is preparing context while the opening summary is still being written", async () => {
  setup();
  await using screen = await render(composer({ openingStatus: "pending", runActive: true }));

  await expect.element(screen.getByText("Preparing context…")).toBeVisible();
  await screen.rerender(composer({ openingStatus: "ready", runActive: true }));
  await expect.element(screen.getByText("Preparing context…")).not.toBeInTheDocument();
});

it("quotes a cited selection into the side chat's own draft", async () => {
  setup();
  useComposerDraftStore.getState().setPrompt(SIDE_CHAT_REF, "Why");
  const handleRef = createRef<SideChatComposerHandle>();
  await using _screen = await render(
    <>
      <div data-assistant-citation-viewport="">
        <p
          data-assistant-citation-source={CITATION.messageId}
          data-assistant-citation-environment={CITATION.environmentId}
          data-assistant-citation-thread={CITATION.threadId}
        >
          An observation space is what the agent can see.
        </p>
      </div>
      {composer({ handleRef })}
    </>,
  );
  const sourceAnchor = findAssistantCitationSourceAnchor(document, CITATION);
  if (!sourceAnchor) throw new Error("Citation source did not resolve");

  const cited = await act(() => handleRef.current?.citeAssistantText(CITATION, sourceAnchor));

  expect(cited).toBe(true);
  expect(draft()).toBe(`Why ${serializeAssistantCitation(CITATION)} `);
  await expect.element(page.getByLabelText("Comment on selected text")).toBeVisible();
});

it("keeps a pending question's answer apart from the side chat's draft", async () => {
  const dispatch = setup();
  useComposerDraftStore.getState().setPrompt(SIDE_CHAT_REF, "A follow-up");
  const onAnswer = vi.fn();
  const onAdvancePendingUserInput = vi.fn();
  const handleRef = createRef<SideChatComposerHandle>();
  function Answering() {
    const [answer, setAnswer] = useState("");
    return composer({
      answeringPendingUserInput: true,
      pendingUserInputCustomAnswer: answer,
      onPendingUserInputCustomAnswerChange: (value, cursor) => {
        setAnswer(value);
        onAnswer(value, cursor);
      },
      onAdvancePendingUserInput,
      handleRef,
    });
  }
  await using screen = await render(<Answering />);

  await expect.element(editor(screen)).not.toHaveTextContent("A follow-up");
  await editor(screen).click();
  await userEvent.keyboard("A box");
  await expect.element(editor(screen)).toHaveTextContent("A box");
  expect(onAnswer).toHaveBeenLastCalledWith("A box", 5);
  await act(() => handleRef.current?.insertTextAtEnd("!"));
  expect(onAnswer).toHaveBeenLastCalledWith("A box!", 6);
  expect(draft()).toBe("A follow-up");

  await userEvent.keyboard("{Enter}");
  expect(onAdvancePendingUserInput).toHaveBeenCalledOnce();
  expect(dispatch).not.toHaveBeenCalled();
  expect(draft()).toBe("A follow-up");
});
