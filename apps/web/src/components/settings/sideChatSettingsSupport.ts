import type { ServerSettings } from "@t3tools/contracts";

/** Older servers omit the side-chat keys instead of decoding their defaults. */
export function hasSideChatSettings(
  settings:
    | Partial<
        Pick<ServerSettings, "sideChatInstructions" | "sideChatSkills" | "sideChatModelSelection">
      >
    | null
    | undefined,
): boolean {
  return (
    settings !== null &&
    settings !== undefined &&
    typeof settings.sideChatInstructions === "string" &&
    Array.isArray(settings.sideChatSkills) &&
    settings.sideChatModelSelection !== undefined
  );
}
