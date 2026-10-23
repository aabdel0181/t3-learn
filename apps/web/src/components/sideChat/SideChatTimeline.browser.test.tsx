import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

const state = vi.hoisted(() => ({
  visibleTurnItems: [] as ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadVisibleTurnItems: (() => state.visibleTurnItems) as never,
}));

import { render } from "../../../test/render";
import { makeStreamingTimelineFixture } from "../../test-fixtures";
import {
  peekHeldThreadTimeline,
  peekRememberedThreadTimeline,
  resetHeldThreadTimeline,
} from "../ChatView.logic";
import { SideChatTimeline } from "./SideChatTimeline";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const LESSON_REF = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("lesson-1"));

function setup() {
  resetHeldThreadTimeline();
  state.visibleTurnItems = [];
}

it("shows the side chat's replies without entering the lesson's held timeline", async () => {
  setup();
  const fixture = makeStreamingTimelineFixture("A Box is a bounded space of numbers.");
  state.visibleTurnItems = fixture.visibleTurnItems;
  const sideChatRef = scopeThreadRef(ENVIRONMENT_ID, fixture.threadId);
  const props = {
    lessonRef: LESSON_REF,
    sideChatRef,
    detailRef: sideChatRef,
    projection: null,
    detailLoading: false,
    optimisticMessages: [],
    listRef: createRef<LegendListRef | null>(),
    citationRequest: null,
    askInSideChatPending: false,
    onCiteAssistantText: () => true,
    onAskInSideChat: () => true,
    onOpenThread: () => {},
    workspaceRoot: undefined,
  } satisfies ComponentProps<typeof SideChatTimeline>;
  const container = document.createElement("div");
  container.style.cssText = "height: 480px; width: 800px; display: flex; flex-direction: column;";

  await using screen = await render(<SideChatTimeline {...props} />, { container });

  await expect.element(screen.getByText("A Box is a bounded space of numbers.")).toBeVisible();
  expect(peekRememberedThreadTimeline(scopedThreadKey(sideChatRef))).toBeNull();
  expect(peekHeldThreadTimeline()).toBeNull();
});
