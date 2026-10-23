import { type AssistantCitation, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeSideChatThreadFixture, makeThreadFixture } from "../../test-fixtures";
import { findOverlappingSideChat, sideChatAnchorFromCitation } from "./sideChatSelection";

const lessonId = ThreadId.make("lesson-1");
const messageId = MessageId.make("assistant-1");

describe("sideChatAnchorFromCitation", () => {
  it("keeps the selector and drops the text and comment", () => {
    const citation: AssistantCitation = {
      version: 1,
      environmentId: EnvironmentId.make("environment-test"),
      threadId: lessonId,
      messageId,
      text: "observation space",
      comment: "What does this mean?",
      start: 20,
      end: 37,
      prefix: "An ",
      suffix: " is what the agent can see.",
    };

    expect(sideChatAnchorFromCitation(citation)).toEqual({
      threadId: lessonId,
      messageId,
      start: 20,
      end: 37,
      prefix: "An ",
      suffix: " is what the agent can see.",
    });
  });
});

describe("findOverlappingSideChat", () => {
  it("finds a side chat whose highlight overlaps the selection in the same reply", () => {
    const selection = { threadId: lessonId, messageId, start: 25, end: 40 };
    const others = [
      makeThreadFixture({ id: lessonId, title: "Lesson" }),
      makeSideChatThreadFixture({ id: ThreadId.make("before"), lessonId, start: 10, end: 25 }),
      makeSideChatThreadFixture({ id: ThreadId.make("after"), lessonId, start: 40, end: 52 }),
      makeSideChatThreadFixture({
        id: ThreadId.make("other-reply"),
        lessonId,
        messageId: MessageId.make("assistant-2"),
        start: 20,
        end: 45,
      }),
      makeSideChatThreadFixture({
        id: ThreadId.make("asked-in-a-side-chat"),
        lessonId,
        parentId: ThreadId.make("side-1"),
        start: 20,
        end: 45,
      }),
    ];

    expect(findOverlappingSideChat(others, selection)).toBeNull();
    expect(
      findOverlappingSideChat(
        [
          ...others,
          makeSideChatThreadFixture({ id: ThreadId.make("overlap"), lessonId, start: 38, end: 60 }),
        ],
        selection,
      ),
    ).toBe("overlap");
  });
});
