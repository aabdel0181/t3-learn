import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeSideChatThreadFixture, makeThreadFixture } from "../test-fixtures";
import { selectSideChatTreeShells } from "./entities";

const environmentId = EnvironmentId.make("environment-test");
const lessonId = ThreadId.make("lesson");
const firstId = ThreadId.make("first");

describe("selectSideChatTreeShells", () => {
  it("keeps the lesson and its live side chats from its own environment", () => {
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
      makeSideChatThreadFixture({ id: ThreadId.make("earlier"), lessonId, start: 0, end: 2 }),
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

    expect(
      selectSideChatTreeShells(scopeThreadRef(environmentId, lessonId), shells).map(
        (shell) => shell.id,
      ),
    ).toEqual(["lesson", "first", "nested", "earlier", "other-message"]);
  });
});
