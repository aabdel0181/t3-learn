import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  shells: [] as ReadonlyArray<{ readonly id: string }>,
}));

vi.mock(import("../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShell: ((ref: { threadId: string } | null) =>
    ref === null
      ? null
      : (state.shells.find((shell) => shell.id === ref.threadId) ?? null)) as never,
  readSideChatTreeShells: (() => state.shells) as never,
}));

vi.mock(import("../state/shell"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentShellStatus: (() => "live") as never,
}));

vi.mock(import("./ChatView"), async () => {
  const { createElement } = await import("react");
  return { default: (() => createElement("p", null, "Chat view")) as never };
});

import { render } from "../../test/render";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { makeSideChatThreadFixture, makeThreadFixture } from "../test-fixtures";
import { ThreadRouteView } from "./ThreadRouteView";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const LESSON_ID = ThreadId.make("lesson-1");
const LESSON_REF = scopeThreadRef(ENVIRONMENT_ID, LESSON_ID);
const LESSON_SHELL = makeThreadFixture({ id: LESSON_ID, environmentId: ENVIRONMENT_ID });
const SIDE_1 = makeSideChatThreadFixture({
  id: ThreadId.make("side-1"),
  lessonId: LESSON_ID,
  parentId: LESSON_ID,
  messageId: MessageId.make("lesson-1-reply"),
  label: "observation space",
});
const NESTED_1 = makeSideChatThreadFixture({
  id: ThreadId.make("nested-1"),
  lessonId: LESSON_ID,
  parentId: SIDE_1.id,
  messageId: MessageId.make("side-1-reply"),
  label: "Box",
});

function setup() {
  state.shells = [LESSON_SHELL, SIDE_1, NESTED_1];
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
}

it("renders a lesson's own route as its chat view", async () => {
  setup();

  await using screen = await render(
    <ThreadRouteView target={{ kind: "server", threadRef: LESSON_REF }} />,
    { router: "/environment-local/lesson-1" },
  );

  await expect.element(screen.getByText("Chat view")).toBeVisible();
});

it("settles a side chat's route on its lesson with the side chat in the panel", async () => {
  setup();

  await using screen = await render(
    <ThreadRouteView
      target={{ kind: "server", threadRef: scopeThreadRef(ENVIRONMENT_ID, NESTED_1.id) }}
    />,
    { router: "/environment-local/nested-1" },
  );

  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/environment-local/lesson-1"),
  );
  // Replaced, so Back does not land on the side chat's route again.
  expect(screen.router?.history.length).toBe(1);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, LESSON_REF).surfaces,
  ).toEqual([{ id: "side-chat:side-1", kind: "side-chat", threadId: "nested-1" }]);
  await expect.element(screen.getByText("Chat view")).not.toBeInTheDocument();
});
