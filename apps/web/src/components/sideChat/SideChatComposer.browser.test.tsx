import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AssistantCitation,
  EnvironmentId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { createRef, useState, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  dispatch: (async () => undefined) as (...args: never) => Promise<unknown>,
  providers: new Map<EnvironmentId, ReadonlyArray<ServerProvider>>(),
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
vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentProviders: () => state.providers,
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
    selector: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => unknown,
  ) =>
    selector({
      ...DEFAULT_UNIFIED_SETTINGS,
      sendShortcut: "enter",
      followUpBehavior: "steer",
    })) as never,
}));

import { act, render, type Screen } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import { isMacPlatform } from "../../lib/utils";
import { findAssistantCitationSourceAnchor } from "../../lib/assistantTextSelection";
import { makeThreadFixture } from "../../test-fixtures";
import { toastManager } from "../ui/toast";
import { SideChatComposer, type SideChatComposerHandle } from "./SideChatComposer";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const SIDE_CHAT_ID = ThreadId.make("side-1");
const SIDE_CHAT_REF = scopeThreadRef(ENVIRONMENT_ID, SIDE_CHAT_ID);
const CODEX = ProviderInstanceId.make("codex");
const SHELL = makeThreadFixture({ id: SIDE_CHAT_ID, environmentId: ENVIRONMENT_ID });
const CODEX_PROVIDER: ServerProvider = {
  instanceId: CODEX,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-22T00:00:00.000Z",
  models: [
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
    { slug: "gpt-5.3", name: "GPT-5.3", isCustom: false, capabilities: null },
    { slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
};
const TEST_PROVIDERS = new Map([[ENVIRONMENT_ID, [CODEX_PROVIDER]]]);
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

function makeImage(id = "draft-image"): ComposerImageAttachment {
  const file = new File([new Uint8Array([137, 80, 78])], `${id}.png`, { type: "image/png" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  };
}

function dispatchImageInput() {
  const input = document.getElementById(
    `side-chat-images-${scopedThreadKey(SIDE_CHAT_REF)}`,
  ) as HTMLInputElement;
  const transfer = new DataTransfer();
  transfer.items.add(makeImage().file);
  Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setup(dispatchResult: unknown = AsyncResult.success({ sequence: 1 })) {
  const dispatch = vi.fn(async (_value: unknown) => dispatchResult);
  state.dispatch = dispatch;
  state.providers = new Map(TEST_PROVIDERS);
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  return dispatch;
}

function composer(props: Partial<ComponentProps<typeof SideChatComposer>> = {}) {
  return (
    <SideChatComposer
      sideChatRef={SIDE_CHAT_REF}
      shell={SHELL}
      providerCatalogKnown
      openingStatus="ready"
      hasMessages={false}
      runActive={false}
      turnRunning={false}
      pendingApprovalCount={0}
      canInterrupt={false}
      sendQueuesBehindSetup={false}
      onExpandImage={() => {}}
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
      dispatchMode: "start",
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

it("sends the model chosen in the side chat and leaves the default for new threads alone", async () => {
  const dispatch = setup();
  const before = useComposerDraftStore.getState();
  const shell = makeThreadFixture({
    id: SIDE_CHAT_ID,
    environmentId: ENVIRONMENT_ID,
    modelSelection: {
      instanceId: CODEX,
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
  });
  await using screen = await render(composer({ shell }));
  const pick = async (name: RegExp) => {
    await screen.getByRole("button", { name: "Choose side chat model" }).click();
    await page.getByRole("option", { name }).click();
  };
  await pick(/GPT-5\.2/);
  await pick(/GPT-5\.4/);
  await typeQuestion(screen);
  await sendButton(screen).click();
  await pick(/GPT-5\.2/);
  await typeQuestion(screen);
  await sendButton(screen).click();
  expect(
    dispatch.mock.calls.map(
      ([call]) => (call as { input: { modelSelection: unknown } }).input.modelSelection,
    ),
  ).toEqual([
    { instanceId: CODEX, model: "gpt-5.4", options: [{ id: "reasoningEffort", value: "high" }] },
    { instanceId: CODEX, model: "gpt-5.2" },
  ]);
  const after = useComposerDraftStore.getState();
  expect(after.stickyModelSelectionByProvider).toEqual(before.stickyModelSelectionByProvider);
  expect(after.stickyActiveProvider).toEqual(before.stickyActiveProvider);
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
  expect(onOptimisticMessageFailed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: optimistic.id }),
  );
  expect(toast).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "error",
      title: "Couldn't send to the side chat",
      description: "The provider is not signed in.",
    }),
  );
});

const MOD_ENTER = isMacPlatform(navigator.platform)
  ? "{Meta>}{Enter}{/Meta}"
  : "{Control>}{Enter}{/Control}";

it.each([
  ["steers on Enter", {}, "{Enter}", "steer", "steer"],
  ["queues on Mod+Enter", {}, MOD_ENTER, "queue", "queued_turn"],
  [
    "queues on Enter while an approval is pending",
    { pendingApprovalCount: 1 },
    "{Enter}",
    "queue",
    "queued_turn",
  ],
  [
    "queues on Enter behind a preparing or starting run",
    { turnRunning: false, sendQueuesBehindSetup: true },
    "{Enter}",
    "queue",
    "queued_turn",
  ],
] as const)("%s while the side chat is answering", async (_name, extra, action, mode, intent) => {
  const dispatch = setup();
  const onOptimisticMessage = vi.fn();
  await using screen = await render(
    composer({ runActive: true, turnRunning: true, onOptimisticMessage, ...extra }),
  );
  await typeQuestion(screen);
  await userEvent.keyboard(action);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ input: expect.objectContaining({ dispatchMode: mode }) }),
  );
  expect(onOptimisticMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ inputIntent: intent }),
  );
});

it("queues on a Cmd/Ctrl-click while the side chat is answering", async () => {
  const dispatch = setup();
  const onOptimisticMessage = vi.fn();
  await using screen = await render(
    composer({ runActive: true, turnRunning: true, onOptimisticMessage }),
  );
  await typeQuestion(screen);
  await screen
    .getByRole("button", { name: "Steer message" })
    .click({ modifiers: ["ControlOrMeta"] });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ input: expect.objectContaining({ dispatchMode: "queue" }) }),
  );
  expect(onOptimisticMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ inputIntent: "queued_turn" }),
  );
});

it.each([
  ["shows Stop while running", true, true, false],
  ["shows Stop while starting", true, false, false],
  ["steers instead of stopping when there is text", true, true, true],
  ["hides Stop without an interrupt", false, true, false],
] as const)("%s", async (_name, canInterrupt, turnRunning, withText) => {
  setup();
  await using screen = await render(composer({ canInterrupt, turnRunning }));
  if (withText) await typeQuestion(screen);
  if (canInterrupt && !withText)
    await expect.element(screen.getByRole("button", { name: "Stop" })).toBeVisible();
  else await expect.element(screen.getByRole("button", { name: "Steer message" })).toBeVisible();
});

it("steers an image-only draft instead of stopping", async () => {
  const dispatch = setup();
  useComposerDraftStore.getState().addImage(SIDE_CHAT_REF, makeImage());
  await using screen = await render(composer({ canInterrupt: true, turnRunning: true }));
  await expect.element(screen.getByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Steer message" }).click();
  await vi.waitFor(() =>
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        input: expect.objectContaining({
          dispatchMode: "steer",
          message: expect.objectContaining({
            attachments: [expect.objectContaining({ type: "image", name: "draft-image.png" })],
          }),
        }),
      }),
    ),
  );
});

it("interrupts the side chat when Stop is clicked", async () => {
  const dispatch = setup();
  await using screen = await render(composer({ canInterrupt: true, turnRunning: true }));
  await screen.getByRole("button", { name: "Stop" }).click();
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId: ENVIRONMENT_ID,
    input: { threadId: SIDE_CHAT_ID },
  });
});

it("removes a ready image from the side chat draft", async () => {
  setup();
  useComposerDraftStore.getState().addImage(SIDE_CHAT_REF, makeImage());
  await using screen = await render(composer());
  await screen.getByRole("button", { name: "Remove draft-image.png" }).click();
  expect(
    useComposerDraftStore.getState().getComposerDraft(SIDE_CHAT_REF)?.images ?? [],
  ).toHaveLength(0);
});

it("sends an attached image and restores it when the send fails", async () => {
  setup(AsyncResult.failure(Cause.fail(new Error("Refused"))));
  const onOptimisticMessage = vi.fn();
  const onOptimisticMessageFailed = vi.fn();
  await using screen = await render(composer({ onOptimisticMessage, onOptimisticMessageFailed }));
  using toast = vi.spyOn(toastManager, "add").mockReturnValue("toast-image");
  dispatchImageInput();
  await typeQuestion(screen);
  await sendButton(screen).click();
  await vi.waitFor(() =>
    expect(useComposerDraftStore.getState().getComposerDraft(SIDE_CHAT_REF)?.images).toHaveLength(
      1,
    ),
  );
  expect(onOptimisticMessage).toHaveBeenCalledOnce();
  expect(onOptimisticMessageFailed).toHaveBeenCalledOnce();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Couldn't send to the side chat" }),
  );
});

it("refuses an image while answering a question", async () => {
  setup();
  await using _screen = await render(composer({ answeringPendingUserInput: true }));
  using toast = vi.spyOn(toastManager, "add").mockReturnValue("toast-question-image");
  dispatchImageInput();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "This question cannot accept attachments." }),
  );
  expect(
    useComposerDraftStore.getState().getComposerDraft(SIDE_CHAT_REF)?.images ?? [],
  ).toHaveLength(0);
});

it("says it is preparing context while the opening summary is still being written", async () => {
  setup();
  await using screen = await render(
    composer({ openingStatus: "pending", runActive: true, turnRunning: false }),
  );

  await expect.element(screen.getByText("Preparing context…")).toBeVisible();
  await screen.rerender(composer({ openingStatus: "ready", runActive: true, turnRunning: false }));
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
      turnRunning: true,
      canInterrupt: true,
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
  await expect.element(screen.getByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Submit answer" }).click();
  expect(onAdvancePendingUserInput).toHaveBeenCalledOnce();
  expect(dispatch).not.toHaveBeenCalled();
  await editor(screen).click();
  await userEvent.keyboard("A box");
  await expect.element(editor(screen)).toHaveTextContent("A box");
  expect(onAnswer).toHaveBeenLastCalledWith("A box", 5);
  await act(() => handleRef.current?.insertTextAtEnd("!"));
  expect(onAnswer).toHaveBeenLastCalledWith("A box!", 6);
  expect(draft()).toBe("A follow-up");

  await userEvent.keyboard("{Enter}");
  expect(onAdvancePendingUserInput).toHaveBeenCalledTimes(2);
  expect(dispatch).not.toHaveBeenCalled();
  expect(draft()).toBe("A follow-up");
});
