import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface, SideChatSurface } from "../../rightPanelStore";
import { makeSideChatThreadFixture, makeThreadFixture } from "../../test-fixtures";
import {
  isSideChatNotificationQuiet,
  resolveFinishableSideChat,
  resolveThreadOpenTarget,
  sideChatLessonRef,
} from "./sideChatNavigation";

const environmentId = EnvironmentId.make("environment-test");
const lessonId = ThreadId.make("lesson");
const sideId = ThreadId.make("side");
const nestedId = ThreadId.make("nested");

const lesson = makeThreadFixture({ id: lessonId, title: "Lesson" });
const side = makeSideChatThreadFixture({ id: sideId, lessonId });
const nested = makeSideChatThreadFixture({
  id: nestedId,
  lessonId,
  parentId: sideId,
  label: "Box",
});

describe("side-chat navigation targets", () => {
  it("opens a side chat on its lesson's route and an ordinary thread on its own", () => {
    expect(resolveThreadOpenTarget(lesson)).toEqual({
      routeThreadId: lessonId,
      sideChatThreadId: null,
    });
    expect(resolveThreadOpenTarget(nested)).toEqual({
      routeThreadId: lessonId,
      sideChatThreadId: nestedId,
    });
    expect(sideChatLessonRef(nested)).toEqual({ environmentId, threadId: lessonId });
    expect(sideChatLessonRef(lesson)).toEqual({ environmentId, threadId: lessonId });
  });

  it("keeps side-chat notifications quiet only while their lesson is on screen", () => {
    const onScreen = {
      environmentId,
      thread: nested,
      activeEnvironmentId: environmentId,
      activeThreadId: lessonId,
      documentActive: true,
    };
    expect(isSideChatNotificationQuiet(onScreen)).toBe(true);
    expect(isSideChatNotificationQuiet({ ...onScreen, documentActive: false })).toBe(false);
    expect(isSideChatNotificationQuiet({ ...onScreen, activeThreadId: "fork" })).toBe(false);
    expect(isSideChatNotificationQuiet({ ...onScreen, activeEnvironmentId: "elsewhere" })).toBe(
      false,
    );
    expect(isSideChatNotificationQuiet({ ...onScreen, thread: lesson })).toBe(false);
  });
});

describe("resolveFinishableSideChat", () => {
  const surface: SideChatSurface = { id: "side-chat:side", kind: "side-chat", threadId: nestedId };
  const map: RightPanelSurface = { id: "thread-map", kind: "thread-map" };
  const input = {
    surfaces: [surface, map],
    activeSurfaceId: surface.id,
    shells: [lesson, side, nested],
    environmentId,
  };

  it("finishes the open side chat the panel shows", () => {
    expect(resolveFinishableSideChat(input)).toEqual({ threadId: nestedId, label: "Box", surface });

    const doneNested = makeSideChatThreadFixture({
      id: nestedId,
      lessonId,
      parentId: sideId,
      label: "Box",
      state: "done",
    });
    expect(resolveFinishableSideChat({ ...input, shells: [lesson, side, doneNested] })).toBeNull();
    expect(resolveFinishableSideChat({ ...input, activeSurfaceId: map.id })).toBeNull();
    expect(resolveFinishableSideChat({ ...input, surfaces: [], activeSurfaceId: null })).toBeNull();
  });
});
