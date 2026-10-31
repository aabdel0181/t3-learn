import { describe, expect, it } from "vite-plus/test";
import { buildSideChatSkillMentions } from "./sideChatSkills.ts";

const skill = (name: string, enabled = true, userInvocable = true) => ({
  name,
  displayName: name,
  path: `/skills/${name}`,
  enabled,
  userInvocable,
  scope: "user",
});

describe("buildSideChatSkillMentions", () => {
  it("filters, normalizes, deduplicates and appends after the question", () => {
    expect(
      buildSideChatSkillMentions({
        text: "Explain this",
        configuredNames: ["$review", "review", "hidden", "agent-only"],
        skills: [skill("review"), skill("hidden", false), skill("agent-only", true, false)],
        openingTurn: true,
      }),
    ).toBe("Explain this\n$review");
  });

  it.each(["/goal explain", "/compact", "/help"])("does not modify slash command %s", (text) => {
    expect(
      buildSideChatSkillMentions({
        text,
        configuredNames: ["review"],
        skills: [skill("review")],
        openingTurn: true,
      }),
    ).toBe(text);
  });

  it("does not duplicate a skill already present in the question", () => {
    expect(
      buildSideChatSkillMentions({
        text: "Explain this with $review",
        configuredNames: ["review"],
        skills: [skill("review")],
        openingTurn: true,
      }),
    ).toBe("Explain this with $review");
    expect(
      buildSideChatSkillMentions({
        text: "Use $Review here",
        configuredNames: ["review"],
        skills: [skill("review")],
        openingTurn: true,
      }),
    ).toBe("Use $Review here\n$review");
    expect(
      buildSideChatSkillMentions({
        text: "Use €review here",
        configuredNames: ["review"],
        skills: [skill("review")],
        openingTurn: true,
      }),
    ).toBe("Use €review here");
    expect(
      buildSideChatSkillMentions({
        text: "Use $superpowers:brainstorming here",
        configuredNames: ["superpowers:brainstorming"],
        skills: [skill("superpowers:brainstorming")],
        openingTurn: true,
      }),
    ).toBe("Use $superpowers:brainstorming here");
    expect(
      buildSideChatSkillMentions({
        text: "Explain this with $review, please",
        configuredNames: ["review"],
        skills: [skill("review")],
        openingTurn: true,
      }),
    ).toBe("Explain this with $review, please\n$review");
  });

  it("deduplicates configured names case-insensitively", () => {
    expect(
      buildSideChatSkillMentions({
        text: "Explain",
        configuredNames: ["Review", "review"],
        skills: [skill("review")],
        openingTurn: true,
      }),
    ).toBe("Explain\n$review");
  });
});
