import type { AssistantCitation, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

/** A side chat this client asked for whose shell may not have arrived yet. */
export interface PendingSideChat {
  readonly threadId: ThreadId;
  readonly lessonThreadKey: string;
  readonly citation: AssistantCitation;
  /** `started` once the server accepted the open. */
  readonly status: "starting" | "started";
}

interface PendingSideChatState {
  /** Keyed by the side chat's scoped thread key. Memory only: a reload forgets it. */
  readonly byThreadKey: Readonly<Record<string, PendingSideChat>>;
  /**
   * The side chat whose composer takes the cursor when its panel next shows it. Set when
   * the control that opened it goes away with the click, leaving focus nowhere, and the
   * panel may not be mounted yet. Memory only.
   */
  readonly focusThreadKey: string | null;
  readonly begin: (threadKey: string, entry: PendingSideChat) => void;
  readonly markStarted: (threadKey: string) => void;
  readonly remove: (threadKey: string) => void;
  /** Forgets the lesson's side chats whose shells have arrived. */
  readonly prune: (lessonThreadKey: string, liveThreadIds: ReadonlySet<string>) => void;
  readonly requestFocus: (threadKey: string) => void;
  readonly clearFocus: (threadKey: string) => void;
}

export const usePendingSideChatStore = create<PendingSideChatState>()((set) => ({
  byThreadKey: {},
  focusThreadKey: null,
  begin: (threadKey, entry) =>
    set((state) => ({ byThreadKey: { ...state.byThreadKey, [threadKey]: entry } })),
  markStarted: (threadKey) =>
    set((state) => {
      const entry = state.byThreadKey[threadKey];
      if (entry === undefined || entry.status === "started") return state;
      return {
        byThreadKey: { ...state.byThreadKey, [threadKey]: { ...entry, status: "started" } },
      };
    }),
  remove: (threadKey) =>
    set((state) => {
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
  prune: (lessonThreadKey, liveThreadIds) =>
    set((state) => {
      const entries = Object.entries(state.byThreadKey);
      const kept = entries.filter(
        ([, entry]) =>
          entry.lessonThreadKey !== lessonThreadKey || !liveThreadIds.has(entry.threadId),
      );
      return kept.length === entries.length ? state : { byThreadKey: Object.fromEntries(kept) };
    }),
  requestFocus: (threadKey) => set({ focusThreadKey: threadKey }),
  clearFocus: (threadKey) =>
    set((state) => (state.focusThreadKey === threadKey ? { focusThreadKey: null } : state)),
}));

/** The server has not yet answered a side chat opened from this lesson. */
export function selectStartingSideChat(
  state: Pick<PendingSideChatState, "byThreadKey">,
  lessonThreadKey: string | null,
): boolean {
  if (lessonThreadKey === null) return false;
  return Object.values(state.byThreadKey).some(
    (entry) => entry.lessonThreadKey === lessonThreadKey && entry.status === "starting",
  );
}

export function pendingSideChatThreadIds(
  state: Pick<PendingSideChatState, "byThreadKey">,
  lessonThreadKey: string,
): ReadonlyArray<ThreadId> {
  return Object.values(state.byThreadKey)
    .filter((entry) => entry.lessonThreadKey === lessonThreadKey)
    .map((entry) => entry.threadId);
}
