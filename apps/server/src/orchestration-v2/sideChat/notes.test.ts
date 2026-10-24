import { describe, expect, it } from "@effect/vitest";
import { ScheduledTaskId } from "@t3tools/contracts";

import {
  SIDE_CHAT_NOTES_HEADER,
  SIDE_CHAT_OUTCOME_EXCERPT_HEADER,
  buildSideChatNotesSummaryText,
  buildSideChatOutcomeInput,
  isSideChatNotesHandoff,
  isUserAuthoredSideChatTrigger,
  normalizeSideChatNote,
} from "./notes.ts";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const notesText = buildSideChatNotesSummaryText([
  { label: "observation space", note: "They had not met observation spaces before." },
]);

type TriggerMessage = Parameters<typeof isUserAuthoredSideChatTrigger>[0];

const userMessage = (overrides: Partial<TriggerMessage> = {}): TriggerMessage => ({
  createdBy: "user",
  text: "What is an observation space?",
  attachments: [],
  ...overrides,
});

describe("side-chat notes", () => {
  it("formats ready notes as one labeled line each under the fixed header", () => {
    expect(
      buildSideChatNotesSummaryText([
        { label: "observation space", note: "They had not met observation spaces before." },
        { label: "Box\n  bounds", note: "Prefers a numeric\nexample." },
      ]),
    ).toBe(
      [
        SIDE_CHAT_NOTES_HEADER,
        '• re "observation space": They had not met observation spaces before.',
        '• re "Box bounds": Prefers a numeric example.',
      ].join("\n"),
    );
  });

  it("recognises only the notes handoff it builds", () => {
    const handoff = { strategy: "manual_context", summaryText: notesText } as const;
    expect(isSideChatNotesHandoff(handoff)).toBe(true);
    expect(isSideChatNotesHandoff({ ...handoff, summaryText: "Manual context handoff." })).toBe(
      false,
    );
    expect(isSideChatNotesHandoff({ ...handoff, strategy: "fork_delta_summary" })).toBe(false);
    expect(
      isSideChatNotesHandoff({
        ...handoff,
        history: { messages: [], coverage: "full", omittedItems: 0 },
      }),
    ).toBe(false);
  });

  it("collapses whitespace, treats an explicit null answer as no note, and caps notes at 300 characters", () => {
    expect(normalizeSideChatNote("  The learner\nconfused Box with Discrete. ")).toBe(
      "The learner confused Box with Discrete.",
    );
    for (const text of [null, "  ", "null", "None."]) {
      expect(normalizeSideChatNote(text)).toBeNull();
    }
    const capped = normalizeSideChatNote("x".repeat(400));
    expect(capped).toHaveLength(300);
    expect(capped?.endsWith("…")).toBe(true);
  });

  it("treats only messages a person sent as side-chat triggers", () => {
    expect(isUserAuthoredSideChatTrigger(userMessage())).toBe(true);
    expect(isUserAuthoredSideChatTrigger(userMessage({ createdBy: "agent" }))).toBe(false);
    expect(
      isUserAuthoredSideChatTrigger(
        userMessage({ scheduledTaskId: ScheduledTaskId.make("task-1") }),
      ),
    ).toBe(false);
    expect(
      isUserAuthoredSideChatTrigger(
        userMessage({
          notification: {
            source: { kind: "delegated_task", taskIds: [] },
            outcome: "completed",
            summary: "A task finished.",
          },
        }),
      ),
    ).toBe(false);
    expect(
      isUserAuthoredSideChatTrigger(
        userMessage({ delegatedCompletion: { parentRunId: "run-1", generation: 1, taskIds: [] } }),
      ),
    ).toBe(false);
    expect(isUserAuthoredSideChatTrigger(userMessage({ text: "/compact" }))).toBe(false);
  });
});

describe("buildSideChatOutcomeInput", () => {
  const messages = [
    { role: "user", text: "What is an observation space?" },
    { role: "assistant", text: "It is everything the agent can see." },
  ] as const;

  it("builds the note writer's input from the excerpt, transcript, child notes and the note already sent", () => {
    expect(
      buildSideChatOutcomeInput({
        excerpt: "observation space",
        messages,
        childNotes: [{ label: "Box", note: "Did not know Box bounds." }],
        previousNote: "They had not met observation spaces before.",
      }),
    ).toBe(
      [
        SIDE_CHAT_OUTCOME_EXCERPT_HEADER,
        "observation space",
        "",
        "Side chat transcript:",
        "User: What is an observation space?",
        "Assistant: It is everything the agent can see.",
        "",
        "Notes from nested side chats:",
        '• re "Box": Did not know Box bounds.',
        "",
        "Note already sent to the lesson for this side chat (write only what is new; otherwise reply null):",
        "They had not met observation spaces before.",
      ].join("\n"),
    );
  });

  it("lists the nested notes the side chat's turns took once each, beside the undelivered ones", () => {
    const handoff = (summaryText: string) =>
      ({ strategy: "manual_context", history: undefined, summaryText }) as const;
    const result = buildSideChatOutcomeInput({
      excerpt: "observation space",
      messages,
      childNotes: [
        { label: "Box", note: "Did not know Box bounds." },
        { label: "reward", note: "Thought rewards are always positive." },
      ],
      contextHandoffs: [
        handoff("Opening context: the learner asked about observation spaces."),
        handoff(
          buildSideChatNotesSummaryText([
            { label: "Box", note: "Did not know Box bounds." },
            { label: "Discrete", note: "Mixed up Discrete and Box." },
          ]),
        ),
      ],
      previousNote: null,
    });

    expect(result.split("\n").slice(-4)).toEqual([
      "Notes from nested side chats:",
      '• re "Box": Did not know Box bounds.',
      '• re "Discrete": Mixed up Discrete and Box.',
      '• re "reward": Thought rewards are always positive.',
    ]);
    expect(result).not.toContain("Opening context");
  });

  it("omits the child-note and previous-note sections when there is nothing to put in them", () => {
    const result = buildSideChatOutcomeInput({
      excerpt: "observation space",
      messages,
      childNotes: [],
      previousNote: null,
    });
    expect(result).toBe(
      [
        "Highlighted passage the learner asked about:",
        "observation space",
        "",
        "Side chat transcript:",
        "User: What is an observation space?",
        "Assistant: It is everything the agent can see.",
      ].join("\n"),
    );
    expect(result).not.toContain("Notes from nested");
    expect(result).not.toContain("Note already sent");
  });

  it("keeps the opening question and the latest messages within the budget", () => {
    const budgetChars = 6_000;
    const long = Array.from({ length: 22 }, (_, index) => {
      const role = index % 2 === 0 ? "user" : "assistant";
      const text =
        index === 0
          ? `What is an observation space? ${"a".repeat(970)}`
          : index === 21
            ? "Latest answer."
            : `Message ${index} ${"b".repeat(990)}`;
      return { role, text } as const;
    });

    const result = buildSideChatOutcomeInput({
      excerpt: "observation space",
      messages: long,
      childNotes: [],
      previousNote: null,
      budgetChars,
    });

    expect(result.length).toBeLessThanOrEqual(budgetChars);
    expect(result).toContain("User: What is an observation space?");
    expect(result).toContain("Assistant: Latest answer.");
    const omitted = /\[… (\d+) earlier messages omitted …\]/u.exec(result);
    expect(omitted).not.toBeNull();
    const kept = result.split("\n").filter((line) => /^(?:User|Assistant): /u.test(line)).length;
    expect(kept + Number(omitted?.[1])).toBe(22);
  });

  it("clips only the newest message, from its start, when no whole message fits", () => {
    const budgetChars = 400;
    const result = buildSideChatOutcomeInput({
      excerpt: "observation space",
      messages: [
        { role: "user", text: "What is an observation space?" },
        { role: "assistant", text: `Here is an answer. ${"😀".repeat(500)}` },
      ],
      childNotes: [],
      previousNote: null,
      budgetChars,
    });

    expect(result.length).toBeLessThanOrEqual(budgetChars);
    expect(result).toContain("Assistant: Here is an answer. 😀");
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toContain("earlier messages omitted");
    expect(result).not.toContain("User: What is an observation space?");
    expect(result).not.toMatch(LONE_SURROGATE);
  });
});
