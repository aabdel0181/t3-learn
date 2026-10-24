import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeSideChatThreadFixture, makeThreadFixture } from "../test-fixtures";
import { selectSideChatMarks, selectSideChatTreeShells, sideChatMarksEqual } from "./entities";

const environmentId = EnvironmentId.make("environment-test");
const lessonId = ThreadId.make("lesson");
const firstId = ThreadId.make("first");
const lessonRef = scopeThreadRef(environmentId, lessonId);

const shells = [
  makeThreadFixture({ id: lessonId, title: "Lesson" }),
  makeSideChatThreadFixture({ id: firstId, lessonId }),
  makeSideChatThreadFixture({
    id: ThreadId.make("archived"),
    lessonId,
    archivedAt: "2026-01-02T00:00:00.000Z",
  }),
  makeSideChatThreadFixture({ id: ThreadId.make("nested"), lessonId, parentId: firstId }),
  {
    ...makeSideChatThreadFixture({ id: ThreadId.make("deleted"), lessonId }),
    deletedAt: "2026-01-02T00:00:00.000Z",
  },
  makeSideChatThreadFixture({
    id: ThreadId.make("elsewhere"),
    lessonId: ThreadId.make("other-lesson"),
  }),
  makeSideChatThreadFixture({
    id: ThreadId.make("earlier"),
    lessonId,
    start: 0,
    end: 2,
    state: "done",
    createdAt: "2025-12-31T00:00:00.000Z",
  }),
  makeSideChatThreadFixture({
    id: ThreadId.make("remote"),
    lessonId,
    environmentId: EnvironmentId.make("environment-remote"),
  }),
  makeSideChatThreadFixture({
    id: ThreadId.make("other-message"),
    lessonId,
    messageId: MessageId.make("assistant-2"),
  }),
];

describe("selectSideChatTreeShells", () => {
  it("keeps the lesson and its live side chats from its own environment", () => {
    expect(selectSideChatTreeShells(lessonRef, shells).map((shell) => shell.id)).toEqual([
      "lesson",
      "first",
      "nested",
      "earlier",
      "other-message",
    ]);
  });
});

describe("selectSideChatMarks", () => {
  it("lists the side chats anchored in one message, oldest first", () => {
    expect(
      selectSideChatMarks(lessonRef, MessageId.make("assistant-1"), shells).map((mark) => [
        mark.threadId,
        mark.state,
      ]),
    ).toEqual([
      ["earlier", "done"],
      ["first", "open"],
    ]);
    expect(
      selectSideChatMarks(
        scopeThreadRef(environmentId, firstId),
        MessageId.make("assistant-1"),
        shells,
      ).map((mark) => mark.threadId),
    ).toEqual(["nested"]);
  });

  it("compares marks by what a mark draws", () => {
    const marks = selectSideChatMarks(lessonRef, MessageId.make("assistant-1"), shells);
    const copies = marks.map((mark) => ({ ...mark, anchor: { ...mark.anchor } }));
    const [earlier, first] = copies;

    expect(sideChatMarksEqual(marks, copies)).toBe(true);
    expect(sideChatMarksEqual(marks, [earlier!, { ...first!, state: "done" }])).toBe(false);
    expect(
      sideChatMarksEqual(marks, [earlier!, { ...first!, anchor: { ...first!.anchor, start: 4 } }]),
    ).toBe(false);
  });
});
