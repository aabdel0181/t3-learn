import {
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2SideChat,
  type OrchestrationV2SideChatAnchor,
  ProjectId,
  ProviderInstanceId,
  type RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as EventSink from "../EventSink.ts";
import * as Orchestrator from "../Orchestrator.ts";
import { planSideChatThread } from "../ThreadForkService.ts";

export const LESSON_THREAD_ID = ThreadId.make("thread:side-chat:lesson");
export const SIDE_CHAT_THREAD_ID = ThreadId.make("thread:side-chat:first");
export const LESSON_ANCHOR_MESSAGE_ID = MessageId.make("message:lesson:a1");

export const LESSON_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
};

export const LESSON_TOPIC = "Teach me how reinforcement-learning environments work.";
export const OBSERVATION_PARAGRAPH =
  "Every environment exposes an observation space that describes what the agent can see at each step.";
export const LESSON_ANCHOR_TEXT = `An environment has three parts.\n\n${OBSERVATION_PARAGRAPH}\n\nActions come next.`;
export const OTHER_USER_MESSAGE = "LESSON-ONLY: and how are rewards shaped?";
export const OTHER_ASSISTANT_REPLY = "LESSON-ONLY: rewards are shaped by the environment designer.";

const SIDE_CHAT_PROJECT_ID = ProjectId.make("project:side-chat");

export interface SeedMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming?: boolean;
  readonly runId?: RunId;
}

export const LESSON_MESSAGES: ReadonlyArray<SeedMessage> = [
  { id: MessageId.make("message:lesson:u1"), role: "user", text: LESSON_TOPIC },
  { id: LESSON_ANCHOR_MESSAGE_ID, role: "assistant", text: LESSON_ANCHOR_TEXT },
  { id: MessageId.make("message:lesson:u2"), role: "user", text: OTHER_USER_MESSAGE },
  { id: MessageId.make("message:lesson:a2"), role: "assistant", text: OTHER_ASSISTANT_REPLY },
];

/** The highlight of "observation space" in the lesson's anchor reply. */
export function observationAnchor(
  threadId: ThreadId = LESSON_THREAD_ID,
  messageId: MessageId = LESSON_ANCHOR_MESSAGE_ID,
): OrchestrationV2SideChatAnchor {
  return {
    threadId,
    messageId,
    start: 61,
    end: 78,
    prefix: "Every environment exposes an ",
    suffix: " that describes what",
  };
}

/** The user's open of a side chat on `anchor`, highlighted in its anchor thread. */
export function openSideChatCommand(input: {
  readonly commandId: string;
  readonly threadId: ThreadId;
  readonly anchor: OrchestrationV2SideChatAnchor;
  readonly excerpt: string;
}): Extract<OrchestrationV2Command, { readonly type: "thread.side_chat.open" }> {
  return {
    type: "thread.side_chat.open",
    commandId: CommandId.make(input.commandId),
    threadId: input.threadId,
    anchorThreadId: input.anchor.threadId,
    anchor: input.anchor,
    excerpt: input.excerpt,
    createdBy: "user",
    creationSource: "web",
  };
}

/** Writes finished messages one second apart, as if the provider had produced them. */
export const seedThreadMessages = Effect.fn("sideChatFixtures.seedThreadMessages")(function* (
  threadId: ThreadId,
  messages: ReadonlyArray<SeedMessage>,
) {
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* eventSink.write({
    events: messages.map((message, index) => {
      const createdAt = DateTime.add(now, { seconds: index });
      return {
        id: EventId.make(`event:seed-message:${message.id}`),
        type: "message.updated" as const,
        threadId,
        occurredAt: createdAt,
        payload: {
          ...(message.role === "assistant"
            ? { createdBy: "agent" as const, creationSource: "provider" as const }
            : { createdBy: "user" as const, creationSource: "web" as const }),
          id: message.id,
          threadId,
          runId: message.runId ?? null,
          nodeId: null,
          role: message.role,
          text: message.text,
          attachments: [],
          streaming: message.streaming ?? false,
          createdAt,
          updatedAt: createdAt,
        },
      };
    }),
  });
});

export const createLesson = Effect.fn("sideChatFixtures.createLesson")(function* (
  input: {
    readonly threadId?: ThreadId;
    readonly modelSelection?: ModelSelection;
    readonly worktreePath?: string | null;
    readonly messages?: ReadonlyArray<SeedMessage>;
  } = {},
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threadId = input.threadId ?? LESSON_THREAD_ID;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`command:side-chat:create:${threadId}`),
    threadId,
    projectId: SIDE_CHAT_PROJECT_ID,
    title: "Reinforcement-learning environments",
    modelSelection: input.modelSelection ?? LESSON_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath ?? null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* seedThreadMessages(threadId, input.messages ?? LESSON_MESSAGES);
  return threadId;
});

/** A side chat whose opening summary is still being written. */
export function pendingSideChat(input: {
  readonly anchor: OrchestrationV2SideChatAnchor;
  readonly excerpt: string;
  readonly requestId: string;
  readonly lessonThreadId?: ThreadId;
}): OrchestrationV2SideChat {
  return {
    lessonThreadId: input.lessonThreadId ?? input.anchor.threadId,
    anchor: input.anchor,
    excerpt: input.excerpt,
    excerptContext: OBSERVATION_PARAGRAPH,
    label: input.excerpt,
    opening: { status: "pending", text: null, requestId: input.requestId },
    done: null,
  };
}

/** Writes a side chat thread under its anchor directly, without the open command. */
export const seedSideChatThread = Effect.fn("sideChatFixtures.seedSideChatThread")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly anchorThreadId: ThreadId;
    readonly sideChat: OrchestrationV2SideChat;
  }) {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const { thread: anchorThread } = yield* orchestrator.getThreadRecords(input.anchorThreadId, []);
    const thread = planSideChatThread({
      anchorThread,
      threadId: input.threadId,
      sideChat: input.sideChat,
      createdBy: "user",
      creationSource: "web",
      createdAt: yield* DateTime.now,
    });
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`event:seed-side-chat:${input.threadId}`),
          type: "thread.created",
          threadId: input.threadId,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: thread.createdAt,
          payload: thread,
        },
      ],
    });
    return thread;
  },
);
