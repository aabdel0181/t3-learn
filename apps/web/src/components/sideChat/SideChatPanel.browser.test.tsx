import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadStructure } from "@t3tools/client-runtime/state/shell";
import {
  type AssistantCitation,
  EnvironmentId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2SideChat,
  type OrchestrationV2ThreadProjection,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({
  shells: [] as ReadonlyArray<{ readonly id: string }>,
  projections: {} as Record<string, unknown>,
  visibleTurnItems: [] as ReadonlyArray<unknown>,
  dispatch: (async () => undefined) as (...args: never) => Promise<unknown>,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useSideChatTreeShells: (() => state.shells) as never,
  useQuietThreadShell: ((ref: { threadId: string } | null) =>
    ref === null
      ? null
      : (state.shells.find((shell) => shell.id === ref.threadId) ?? null)) as never,
  useQuietThreadProjection: ((ref: { threadId: string } | null) =>
    ref === null ? null : (state.projections[ref.threadId] ?? null)) as never,
  useSideChatNoteDelivered: ((
    parentRef: { threadId: string } | null,
    sideChatId: string,
    requestId: string,
  ) => {
    const parent =
      parentRef === null
        ? undefined
        : (state.projections[parentRef.threadId] as EnvironmentThreadStructure | undefined);
    return parent === undefined
      ? null
      : parent.projection.thread.sideChatNoteDeliveries?.[ThreadId.make(sideChatId)] === requestId;
  }) as never,
  useThreadVisibleTurnItems: (() => state.visibleTurnItems) as never,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => state.dispatch) as never,
}));

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: (() => async () => undefined) as never,
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
import { useClosedViewStore } from "../../closedViewStore";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  type SideChatSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import {
  makeSideChatThreadFixture,
  makeStreamingTimelineFixture,
  makeThreadFixture,
  makeThreadProjectionFixture,
} from "../../test-fixtures";
import type { Thread } from "../../types";
import { toastManager } from "../ui/toast";
import { askInSideChat } from "./openSideChat";
import { pendingSideChatThreadIds, usePendingSideChatStore } from "./pendingSideChatStore";
import { SideChatMapSurface } from "./SideChatMap";
import { SideChatPanel } from "./SideChatPanel";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const LESSON_ID = ThreadId.make("lesson-1");
const LESSON_REF = scopeThreadRef(ENVIRONMENT_ID, LESSON_ID);
const LESSON_PATH = "/environment-local/lesson-1";
const LESSON_SHELL = makeThreadFixture({
  id: LESSON_ID,
  environmentId: ENVIRONMENT_ID,
  title: "Reinforcement learning",
});
const sideChatRef = (id: string) => scopeThreadRef(ENVIRONMENT_ID, ThreadId.make(id));

function sideChatShell(
  id: string,
  anchorThreadId: string,
  label: string,
  overrides: Partial<Thread> = {},
): Thread {
  return {
    ...makeSideChatThreadFixture({
      id: ThreadId.make(id),
      lessonId: LESSON_ID,
      parentId: ThreadId.make(anchorThreadId),
      messageId: MessageId.make(`${anchorThreadId}-reply`),
      label,
    }),
    ...overrides,
  };
}

const SIDE_1 = sideChatShell("side-1", LESSON_ID, "observation space");
const NESTED_1 = sideChatShell("nested-1", "side-1", "Box");

/** The side chat's detail, as the quiet projection carries it once loaded. */
function sideChatProjection(
  shell: Thread,
  sideChat: Partial<OrchestrationV2SideChat> = {},
  projection: Partial<OrchestrationV2ThreadProjection> = {},
): EnvironmentThreadStructure {
  const base = makeThreadProjectionFixture();
  const anchor = shell.sideChat!.anchor;
  return {
    environmentId: ENVIRONMENT_ID,
    projection: {
      ...base,
      thread: {
        ...base.thread,
        id: shell.id,
        sideChat: {
          lessonThreadId: LESSON_ID,
          anchor,
          excerpt: shell.sideChat!.label,
          excerptContext: "",
          label: shell.sideChat!.label,
          opening: { status: "ready", text: null, requestId: "opening-1" },
          done: null,
          ...sideChat,
        },
      },
      ...projection,
    },
  };
}

/** A pending request of the side chat's AI, as the projection holds it. */
function pendingRequest(
  id: string,
  request: Pick<OrchestrationV2ThreadProjection["runtimeRequests"][number], "kind">,
  item: Record<string, unknown>,
): Pick<OrchestrationV2ThreadProjection, "runtimeRequests" | "turnItems"> {
  const createdAt = makeThreadProjectionFixture().updatedAt;
  return {
    runtimeRequests: [
      {
        id: RuntimeRequestId.make(id),
        nodeId: NodeId.make(id),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: request.kind,
        status: "pending",
        responseCapability: {
          type: "live",
          providerSessionId: ProviderSessionId.make("session-1"),
        },
        createdAt,
        resolvedAt: null,
      },
    ],
    turnItems: [
      {
        id: TurnItemId.make(id),
        threadId: SIDE_1.id,
        runId: null,
        nodeId: NodeId.make(id),
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "running",
        title: null,
        startedAt: createdAt,
        completedAt: null,
        updatedAt: createdAt,
        requestId: RuntimeRequestId.make(id),
        ...item,
      } as OrchestrationV2ThreadProjection["turnItems"][number],
    ],
  };
}

function setup(dispatchResult: Promise<unknown> = Promise.resolve(AsyncResult.success({}))) {
  const dispatch = vi.fn((_value: unknown) => dispatchResult);
  state.dispatch = dispatch;
  state.shells = [LESSON_SHELL];
  state.projections = {};
  state.visibleTurnItems = [];
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
  useClosedViewStore.setState({ entries: [] });
  usePendingSideChatStore.setState({ byThreadKey: {}, focusThreadKey: null });
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  return dispatch;
}

/** Shows `threadId` in the tab of the top-level side chat `topThreadId`. */
function showSideChat(topThreadId: string, threadId: string) {
  useRightPanelStore.getState().openSideChat(LESSON_REF, { topThreadId, threadId });
}

const surfaces = () =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, LESSON_REF).surfaces;

/** The lesson's side-chat tab, as the right panel renders it. */
function Panel(props: { readonly onFocusLesson: () => void }) {
  const surface = useRightPanelStore((store) =>
    selectThreadRightPanelState(store.byThreadKey, LESSON_REF).surfaces.find(
      (entry): entry is SideChatSurface => entry.kind === "side-chat",
    ),
  );
  if (surface === undefined) return null;
  return (
    <SideChatPanel
      key={`${scopedThreadKey(LESSON_REF)}:${surface.id}`}
      lessonRef={LESSON_REF}
      surface={surface}
      visible
      onFocusLesson={props.onFocusLesson}
    />
  );
}

function renderPanel(
  options: { readonly router?: string; readonly onFocusLesson?: () => void } = {},
) {
  const container = document.createElement("div");
  container.style.cssText = "height: 480px; width: 900px; display: flex; flex-direction: column;";
  return render(<Panel onFocusLesson={options.onFocusLesson ?? (() => {})} />, {
    container,
    ...(options.router === undefined ? {} : { router: options.router }),
  });
}

const crumb = (screen: Screen, name: string) =>
  screen
    .getByRole("navigation", { name: "Side chat path" })
    .getByRole("button", { name, exact: true });
const composer = (screen: Screen) => screen.getByRole("textbox", { name: "Side chat message" });
const revealButton = (screen: Screen) =>
  screen.getByRole("button", { name: "Show this highlight where it was asked" });
const doneButton = (screen: Screen) => screen.getByRole("button", { name: "Done", exact: true });
const draft = (id: string) =>
  useComposerDraftStore.getState().getComposerDraft(sideChatRef(id))?.prompt ?? "";

/** Double-clicks `word` in the rendered reply `messageId`, which selects it as a reader would. */
async function selectReplyWord(screen: Screen, messageId: string, word: string) {
  const target = await vi.waitFor(() => {
    const source = screen.container.querySelector(
      `[data-assistant-citation-source="${messageId}"]`,
    );
    if (source === null) throw new Error(`${messageId} has not rendered`);
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(word) ?? -1;
      if (start === -1 || node.parentElement === null) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      const wordRect = range.getBoundingClientRect();
      const elementRect = node.parentElement.getBoundingClientRect();
      return {
        element: node.parentElement,
        position: {
          x: wordRect.left - elementRect.left + wordRect.width / 2,
          y: wordRect.top - elementRect.top + wordRect.height / 2,
        },
      };
    }
    throw new Error(`"${word}" has not rendered in ${messageId}`);
  });
  await userEvent.dblClick(target.element, { position: target.position });
}

it("shows a starting side chat with its excerpt and puts the cursor in its composer", async () => {
  setup();
  const citation: AssistantCitation = {
    version: 1,
    environmentId: ENVIRONMENT_ID,
    threadId: LESSON_ID,
    messageId: MessageId.make("lesson-1-reply"),
    text: "observation space",
    start: 3,
    end: 20,
    prefix: "An ",
    suffix: " is what the agent can see.",
  };
  // The server has not answered yet, so the side chat has no shell.
  const run = vi.fn(() => new Promise<never>(() => {}));
  await using screen = await renderPanel({ router: LESSON_PATH });

  await act(() =>
    askInSideChat({
      lessonRef: LESSON_REF,
      citation,
      sideChatShells: [],
      topThreadId: null,
      run,
    }),
  );

  await expect.element(screen.getByText("Starting side chat…")).toBeVisible();
  await expect.element(revealButton(screen)).toHaveTextContent("observation space");
  await expect.element(crumb(screen, "observation space")).toHaveAttribute("aria-current", "page");
  await expect.element(composer(screen)).toHaveFocus();
  expect(screen.router?.state.location.pathname).toBe(LESSON_PATH);
});

it("puts the cursor in the composer when Ask lands on a highlight that already has a side chat", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  showSideChat("side-1", "side-1");
  const run = vi.fn(() => new Promise<never>(() => {}));
  await using screen = await renderPanel();
  await expect.element(composer(screen)).toBeInTheDocument();
  // Selecting the lesson's text takes focus out of the panel.
  (document.activeElement as HTMLElement).blur();

  await act(() =>
    askInSideChat({
      lessonRef: LESSON_REF,
      citation: {
        version: 1,
        environmentId: ENVIRONMENT_ID,
        threadId: LESSON_ID,
        messageId: MessageId.make("lesson-1-reply"),
        text: "space",
        start: 15,
        end: 20,
        prefix: "An observation ",
        suffix: " is what the agent can see.",
      },
      sideChatShells: state.shells as ReadonlyArray<Thread>,
      topThreadId: null,
      run,
    }),
  );

  await expect.element(composer(screen)).toHaveFocus();
  expect(run).not.toHaveBeenCalled();
});

/** The lesson's panel showing only its active tab, as the right panel does. */
function ActiveTab() {
  const surface = useRightPanelStore((store) => {
    const panel = selectThreadRightPanelState(store.byThreadKey, LESSON_REF);
    return panel.surfaces.find((entry) => entry.id === panel.activeSurfaceId);
  });
  if (surface?.kind === "thread-map") {
    return <SideChatMapSurface threadRef={LESSON_REF} onFocusLesson={() => {}} />;
  }
  if (surface?.kind !== "side-chat") return null;
  return (
    <SideChatPanel
      key={`${scopedThreadKey(LESSON_REF)}:${surface.id}`}
      lessonRef={LESSON_REF}
      surface={surface}
      visible
      onFocusLesson={() => {}}
    />
  );
}

it("puts the cursor in the composer of a side chat opened from the Map", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  useRightPanelStore.getState().open(LESSON_REF, "thread-map");
  const container = document.createElement("div");
  container.style.cssText = "height: 480px; width: 900px; display: flex; flex-direction: column;";
  await using screen = await render(<ActiveTab />, { container });
  const node = screen.getByRole("treeitem", { name: "observation space", exact: true });
  await expect.element(node).toBeInTheDocument();

  (node.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await expect.element(composer(screen)).toHaveFocus();
});

it("keeps the excerpt and the empty conversation between the shell arriving and the detail loading", async () => {
  setup();
  const citation: AssistantCitation = {
    version: 1,
    environmentId: ENVIRONMENT_ID,
    threadId: LESSON_ID,
    messageId: MessageId.make("lesson-1-reply"),
    text: "observation space",
    start: 3,
    end: 20,
    prefix: "An ",
    suffix: " is what the agent can see.",
  };
  const run = vi.fn(() => new Promise<never>(() => {}));
  await using screen = await renderPanel({ router: LESSON_PATH });
  await act(() =>
    askInSideChat({
      lessonRef: LESSON_REF,
      citation,
      sideChatShells: [],
      topThreadId: null,
      run,
    }),
  );
  await expect.element(revealButton(screen)).toHaveTextContent("observation space");
  const lessonKey = scopedThreadKey(LESSON_REF);
  const [id] = pendingSideChatThreadIds(usePendingSideChatStore.getState(), lessonKey);

  // The shell lands and the lesson forgets the pending entry; the detail is still loading.
  state.shells = [LESSON_SHELL, sideChatShell(id!, LESSON_ID, "observation space")];
  act(() => usePendingSideChatStore.getState().prune(lessonKey, new Set([id!])));

  await expect.element(revealButton(screen)).toHaveTextContent("observation space");
  await expect.element(screen.getByText("Send a message to start the conversation.")).toBeVisible();
});

it("Done on a nested side chat returns to its parent without waiting for the note", async () => {
  // The finish never settles: the panel must not wait for the note.
  const dispatch = setup(new Promise(() => {}));
  state.shells = [LESSON_SHELL, SIDE_1, NESTED_1];
  showSideChat("side-1", "nested-1");
  await using screen = await renderPanel();

  await doneButton(screen).click();

  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId: ENVIRONMENT_ID,
    input: { threadId: "nested-1" },
  });
  expect(surfaces()).toEqual([
    {
      id: "side-chat:side-1",
      kind: "side-chat",
      threadId: "side-1",
      trail: ["side-1", "nested-1"],
    },
  ]);
});

it("Done on a top-level side chat closes its tab and remembers it for reopening", async () => {
  const dispatch = setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();

  await doneButton(screen).click();

  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId: ENVIRONMENT_ID,
    input: { threadId: "side-1" },
  });
  expect(surfaces()).toEqual([]);
  expect(useClosedViewStore.getState().entries).toEqual([
    {
      id: expect.any(String),
      kind: "panel-tab",
      threadRef: LESSON_REF,
      surface: { id: "side-chat:side-1", kind: "side-chat", threadId: "side-1" },
    },
  ]);
});

it("Discard finishes the side chat without a note", async () => {
  const dispatch = setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();

  await screen.getByRole("button", { name: "More side chat actions" }).click();
  await page.getByRole("menuitem", { name: "Discard" }).click();

  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId: ENVIRONMENT_ID,
    input: { threadId: "side-1", discard: true },
  });
  expect(surfaces()).toEqual([]);
});

const lessonMessage = () => page.getByRole("textbox", { name: "Lesson message" });

/** The panel beside a stand-in for the lesson's composer, which the panel hands the cursor to. */
function renderPanelBesideLesson() {
  const container = document.createElement("div");
  container.style.cssText = "height: 480px; width: 900px; display: flex; flex-direction: column;";
  return render(
    <>
      <textarea aria-label="Lesson message" />
      <Panel onFocusLesson={() => (lessonMessage().element() as HTMLElement).focus()} />
    </>,
    { container },
  );
}

it("hands the cursor to the lesson when Discard closes the side chat's tab", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  showSideChat("side-1", "side-1");
  await using screen = await renderPanelBesideLesson();
  const actions = screen.getByRole("button", { name: "More side chat actions" });
  await expect.element(actions).toBeInTheDocument();

  (actions.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("menuitem", { name: "Discard" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");

  expect(surfaces()).toEqual([]);
  await expect.element(lessonMessage()).toHaveFocus();
});

it("hands the cursor to the lesson when Done closes a side chat's tab beside another", async () => {
  setup();
  const side2 = sideChatShell("side-2", LESSON_ID, "reward signal");
  state.shells = [LESSON_SHELL, SIDE_1, side2];
  showSideChat("side-1", "side-1");
  showSideChat("side-2", "side-2");
  await using screen = await renderPanelBesideLesson();
  await expect.element(crumb(screen, "observation space")).toHaveAttribute("aria-current", "page");

  (doneButton(screen).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await expect.element(crumb(screen, "reward signal")).toHaveAttribute("aria-current", "page");
  await expect.element(lessonMessage()).toHaveFocus();
});

it("walks the breadcrumb Lesson › observation space › Box in place", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1, NESTED_1];
  showSideChat("side-1", "nested-1");
  const onFocusLesson = vi.fn();
  await using screen = await renderPanel({ onFocusLesson });

  await expect.element(crumb(screen, "Box")).toHaveAttribute("aria-current", "page");
  await crumb(screen, "observation space").click();
  expect(surfaces()).toEqual([
    {
      id: "side-chat:side-1",
      kind: "side-chat",
      threadId: "side-1",
      trail: ["side-1", "nested-1"],
    },
  ]);
  await expect.element(crumb(screen, "observation space")).toHaveAttribute("aria-current", "page");

  await crumb(screen, "Box").click();
  expect(surfaces()).toEqual([{ id: "side-chat:side-1", kind: "side-chat", threadId: "nested-1" }]);

  await crumb(screen, "Lesson").click();
  expect(onFocusLesson).toHaveBeenCalledOnce();
});

/** A finished side chat whose note is ready, and the parent that may have received it. */
function doneWithNote(
  shell: Thread,
  note: string,
  parentDeliveries: OrchestrationV2AppThread["sideChatNoteDeliveries"],
) {
  const done: Thread = {
    ...shell,
    sideChat: { ...shell.sideChat!, state: "done", noteStatus: "ready" },
  };
  const parentId = shell.sideChat!.anchor.threadId;
  const base = makeThreadProjectionFixture();
  const parent: EnvironmentThreadStructure = {
    environmentId: ENVIRONMENT_ID,
    projection: {
      ...base,
      thread: { ...base.thread, id: parentId, sideChatNoteDeliveries: parentDeliveries },
    },
  };
  return {
    done,
    projections: {
      [done.id]: sideChatProjection(done, {
        done: {
          at: "2026-10-22T00:00:00.000Z",
          outcome: { status: "ready", note, requestId: "note-1" },
        },
      }),
      [parentId]: parent,
    },
  };
}

it("shows the note a finished side chat sent to the lesson", async () => {
  setup();
  const note = "They didn't know what an observation space is.";
  const { done, projections } = doneWithNote(SIDE_1, note, { [SIDE_1.id]: "note-1" });
  state.shells = [LESSON_SHELL, done];
  state.projections = projections;
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();

  await expect.element(screen.getByRole("status")).toHaveTextContent(`Sent to lesson: ${note}`);
  await expect.element(doneButton(screen)).not.toBeInTheDocument();
});

it("says a nested side chat's note waits for the parent side chat it goes to", async () => {
  setup();
  const note = "They mixed up Box and Discrete.";
  // side-1 received an earlier note of this side chat, not this one.
  const { done, projections } = doneWithNote(NESTED_1, note, { [NESTED_1.id]: "older-note" });
  state.shells = [LESSON_SHELL, SIDE_1, done];
  state.projections = projections;
  showSideChat("side-1", "nested-1");
  await using screen = await renderPanel();

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(`Goes with your next message in “observation space”: ${note}`);
});

it("reveals a nested highlight in its parent side chat inside the panel", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1, NESTED_1];
  // side-1's history lacks the cited reply, so each reveal ends in one warning.
  state.projections = {
    "side-1": sideChatProjection(SIDE_1),
    "nested-1": sideChatProjection(NESTED_1),
  };
  state.visibleTurnItems = makeStreamingTimelineFixture()
    .visibleTurnItems satisfies ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  showSideChat("side-1", "nested-1");
  await using screen = await renderPanel();
  using toast = vi.spyOn(toastManager, "add");
  const revealWarnings = () =>
    toast.mock.calls.filter(([options]) => options.title === "The cited response is unavailable");

  await expect.element(revealButton(screen)).toHaveTextContent("Box");
  await revealButton(screen).click();

  expect(surfaces()).toMatchObject([{ id: "side-chat:side-1", threadId: "side-1" }]);
  await vi.waitFor(() => expect(revealWarnings()).toHaveLength(1));

  // Walking forward and back returns to side-1 without revealing the highlight again.
  await crumb(screen, "Box").click();
  await expect.element(crumb(screen, "Box")).toHaveAttribute("aria-current", "page");
  await crumb(screen, "observation space").click();
  await expect.element(crumb(screen, "observation space")).toHaveAttribute("aria-current", "page");
  expect(revealWarnings()).toHaveLength(1);
});

it("quotes a selection cited inside the panel into the side chat's draft, not the lesson's", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  state.projections = { "side-1": sideChatProjection(SIDE_1) };
  state.visibleTurnItems = makeStreamingTimelineFixture()
    .visibleTurnItems satisfies ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();

  await selectReplyWord(screen, "history-assistant", "Done");
  await page.getByRole("button", { name: "Cite selection in composer" }).click();

  await vi.waitFor(() =>
    expect(
      collectAssistantCitations(draft("side-1")).map(({ citation }) => [
        citation.threadId,
        citation.messageId,
        citation.text,
      ]),
    ).toEqual([["side-1", "history-assistant", "Done"]]),
  );
  expect(useComposerDraftStore.getState().getComposerDraft(LESSON_REF)).toBeNull();
});

it("types into the side chat when focus is elsewhere in the panel", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();
  const panel = screen.getByRole("region", { name: "Side chat" });
  await expect.element(panel).toBeInTheDocument();

  (panel.element() as HTMLElement).focus();
  await userEvent.keyboard("w");

  expect(draft("side-1")).toBe("w");
  await expect.element(composer(screen)).toHaveFocus();
});

it("leaves PageUp to a draft that can scroll and pages the timeline otherwise", async () => {
  setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  useComposerDraftStore.getState().setPrompt(sideChatRef("side-1"), lines.join("\n"));
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();
  const pageUp = (target: Element) => {
    const event = new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  const editor = await vi.waitFor(() => {
    const element = composer(screen).element() as HTMLElement;
    if (element.scrollHeight <= element.clientHeight) throw new Error("the draft fits");
    return element;
  });
  editor.scrollTop = editor.scrollHeight;
  expect(editor.scrollTop).toBeGreaterThan(0);
  expect(pageUp(editor).defaultPrevented).toBe(false);

  expect(pageUp(screen.getByRole("region", { name: "Side chat" }).element()).defaultPrevented).toBe(
    true,
  );
});

it("answers an approval the side chat's AI is waiting on from the panel", async () => {
  const dispatch = setup();
  state.shells = [LESSON_SHELL, SIDE_1];
  state.projections = {
    "side-1": sideChatProjection(
      SIDE_1,
      {},
      pendingRequest(
        "approval-1",
        { kind: "command" },
        { type: "approval_request", requestKind: "command", prompt: "vp test" },
      ),
    ),
  };
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();

  await screen.getByRole("button", { name: "Approve" }).click();

  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId: ENVIRONMENT_ID,
    input: { threadId: "side-1", requestId: "approval-1", decision: "accept" },
  });
});

it("answers a question the side chat's AI asked from the panel", async () => {
  const dispatch = setup();
  useComposerDraftStore.getState().setPrompt(sideChatRef("side-1"), "A follow-up");
  state.shells = [LESSON_SHELL, SIDE_1];
  state.projections = {
    "side-1": sideChatProjection(
      SIDE_1,
      {},
      pendingRequest(
        "question-1",
        { kind: "user_input" },
        {
          type: "user_input_request",
          questions: [
            {
              id: "q1",
              header: "Space",
              question: "Which space do you mean?",
              options: [
                { label: "Box", description: "A bounded space of numbers" },
                { label: "Discrete", description: "A finite set of choices" },
              ],
            },
          ],
        },
      ),
    ),
  };
  showSideChat("side-1", "side-1");
  await using screen = await renderPanel();

  await expect.element(screen.getByText("Which space do you mean?")).toBeVisible();
  await expect.element(composer(screen)).not.toHaveTextContent("A follow-up");
  await composer(screen).click();
  await userEvent.keyboard("The one with bounds");
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() =>
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      environmentId: ENVIRONMENT_ID,
      input: {
        threadId: "side-1",
        requestId: "question-1",
        answers: { q1: "The one with bounds" },
      },
    }),
  );
  expect(draft("side-1")).toBe("A follow-up");
});
