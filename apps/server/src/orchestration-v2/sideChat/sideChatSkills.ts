import type { ServerProviderSkill } from "@t3tools/contracts";
import { SKILL_MENTION_PATTERN } from "@t3tools/shared/composerInlineTokens";

export function buildSideChatSkillMentions(input: {
  readonly text: string;
  readonly configuredNames: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly openingTurn: boolean;
  readonly onDropped?: (name: string) => void;
}): string {
  if (!input.openingTurn || input.text.trimStart().startsWith("/")) return input.text;
  const existing = new Set(
    [...input.text.matchAll(SKILL_MENTION_PATTERN)].map((match) => match[2]!),
  );
  const seen = new Set<string>();
  const mentions = input.configuredNames.flatMap((rawName) => {
    const name = rawName.trim().replace(/^[\p{Sc}/]+/u, "");
    const normalized = name.toLowerCase();
    if (!normalized || seen.has(normalized)) return [];
    const skill = input.skills.find(
      (candidate) =>
        candidate.name.trim().toLowerCase() === normalized &&
        candidate.enabled &&
        candidate.userInvocable !== false,
    );
    seen.add(normalized);
    if (!skill) {
      input.onDropped?.(name);
      return [];
    }
    const canonicalName = skill.name.trim();
    return !existing.has(canonicalName) ? [`$${canonicalName}`] : [];
  });
  return mentions.length === 0 ? input.text : `${input.text}\n${mentions.join(" ")}`;
}
