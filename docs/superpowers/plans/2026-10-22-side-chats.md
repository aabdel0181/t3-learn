# Side Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner highlights part of an AI reply and chooses **Ask in side chat**. The side chat opens in the right panel beside the lesson and starts from a lesson summary plus the highlight. Its traffic never enters the lesson. **Done** gives the lesson's AI at most a one-to-two-line note on the learner's next message. Side chats nest, and a **Map** tab shows the tree.

**Architecture:**
- **Thread model.** A side chat is an ordinary thread (lineage `fork`, `forkedFrom: null`, no context transfer). It carries an optional `sideChat` struct on the app thread, and the shell carries a slim copy of it.
- **Commands.** Dedicated `thread.side_chat.*` commands, gated on the client by the `sideChats` capability.
- **Background text.** The opening summary and the outcome note are written by outbox effects in a capped text-generation lane. They run with the lesson provider's small text model, in an empty temp cwd, and land through internal completion commands guarded by `requestId`.
- **Context delivery.** Context reaches providers as `manual_context` handoffs with `history` undefined:
  - The opening context is built at provider-turn start whenever a side chat gets a fresh native context. It first waits up to `SIDE_CHAT_WAIT_CAP_MS` for a pending summary.
  - Notes are attached when the parent's next user-authored run starts. A gate waits up to the same cap for notes still being written.
- **Web.**
  - An Ask action sits beside Cite.
  - Side-chat and Map surfaces live on the lesson's right panel.
  - Marks are painted in lesson replies with the CSS Custom Highlight API.
  - A `[data-side-chat-panel]` scope keeps panel input away from the lesson composer.
- **Deliberate deviation from the design's §3/§4 wording.** Opening context and notes are attached at run start (`ProviderTurnStartService` and an effect-worker gate), not in `Orchestrator.dispatchMessage`. The orchestrator cannot wait, and run start is the one point that covers immediate, queued and auto-Done sends, provider switches and replaced native threads.

**Tech Stack:** TypeScript; Effect 4 (`effect/Schema`, `@effect/vitest`, `TestClock`); SQLite projections stored as JSON; React 19 with the React Compiler; Effect atoms (`effect/reactivity`); zustand; Vitest browser mode (Playwright Chromium) through `vp`; the CSS Custom Highlight API.

**Spec:** `docs/superpowers/specs/2026-10-22-side-chat-design.md` (the design) and `docs/superpowers/specs/2026-10-22-side-chat-prd.md` (R1 to R11). Repo rules: `AGENTS.md` at upstream `22840ab9`.

## Global Constraints

- Prerequisites: fork-setup Part A is done, and the citation-fix PR is merged into fork `main`. Work happens only in the linked worktree `/home/quokka/.t3/projects/t3-sidechat-dev`, on branch `feature/side-chats`.
- Line numbers refer to upstream `22840ab9`. Fork `main` may drift, so find code by the symbol named next to each range.
- Never modify `/tmp/t3recon/t3code`. Never touch `~/.t3/userdata` or the `t3code` systemd service. Never kill a process by pattern. Run dev servers only from the worktree, confirm with `vp run dev --dry-run`, and set `T3CODE_TELEMETRY_ENABLED=false`. Task subagents do not start dev servers. Add no new telemetry event in v1.
- Excerpt ≤ 4000 chars (above that Ask shows "Shorten selection"). `excerptContext` ≤ 1500 chars. `label` ≤ 120 chars. Note: one or two sentences, ≤ 300 chars. Summary ≤ `SIDE_CHAT_SUMMARY_MAX_CHARS` = 2000.
- Summarizer input budget is about 24k chars (`SIDE_CHAT_SUMMARIZER_INPUT_BUDGET_CHARS` = 24000). Sends wait at most ~15s for a summary or note still being written (`SIDE_CHAT_WAIT_CAP_MS` = 15000).
- Global effect-worker concurrency is 4 (`EffectWorker.ts:835`). The text-generation lane holds at most `TEXT_GENERATION_LANE_MAX_CONCURRENCY` = 2.
- Add no new literal to any strict union: `relationshipToParent`, transfer `type` and `resolution.strategy`, handoff `strategy`, turn item `type`. Add only optional fields. Gate the client on `capabilities.sideChats`.
- One deliberate exception: `KeybindingCommand` gains `"sideChat.askSelection"` (Task 53). A keybinding users can change needs a command literal. The spec's wire rule is about server upserts, so the server never writes this command into `keybindings.json` on its own: the startup default sync skips `sideChat.*` defaults (`apps/server/src/keybindings.ts:461-575` writes every missing `DEFAULT_KEYBINDINGS` rule to disk), and the default chord still applies through `mergeWithDefaultKeybindings` in memory. Only a user who rebinds it writes the entry. An official server rejects such an entry as `keybindings.invalid-entry` and then skips its default sync for good, so the release plan's `fork-service-switch.sh --to-official` strips `sideChat.*` entries after its backup (fork-setup Task 11).
- Side chats create no pending `fork` or `merge_back` transfers.
- No SQL migration. New structs use ISO strings, not `DateTime`. Do not bump `ORCHESTRATION_PROTOCOL_VERSION` or `ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION`.
- Shells stay slim. Excerpts, summaries and notes live on the app thread (thread detail), never on the shell.
- Handoffs for side chats use strategy `manual_context`, with `history` undefined and the content in `summaryText`.
- Notes header, verbatim: `Side-chat notes (the user asked about these separately; don't reply to them directly):`. Then one line per note: `• re "<label>": <note>`.
- UI copy, verbatim:
  - Actions: "Ask in side chat", "Shorten selection", "Done", "Discard".
  - Waits: "Starting side chat…", "Preparing context…", "Adding side-chat note…".
  - Dividers: "Side chat context", "Side-chat notes included".
  - Outcomes: "Sent to lesson: …", "No note needed", "Writing note…", "Couldn't write the note" (never "No note sent").
  - Refusal: "Use Done for side chats".
  - Palette: "Open side-chat map", "Finish side chat (Done)".
- The `sideChat.askSelection` default must not collide. `mod+shift+l` is taken (`composer.previousWorktree`).
- React Compiler: no `useMemo`/`useCallback` and no `try/finally` in components. Use no repaint animations and theme tokens only.
- Tests:
  - Server: drain `OrchestrationEffectWorkerV2`, or await a persisted event or a `Deferred`. No sleeps, timeouts, polling or `retry`. `it.effect` runs on `TestClock`.
  - Web browser tests use `await using screen = await render(...)` from `apps/web/test/render.tsx`, and assert with `expect.element` / `vi.waitFor`.
- Checks:
  - While iterating: `vp test run <files> [-t "<name>"]`, `vp run --filter <package> typecheck`, `vp lint <files>`.
  - Before pushing: `vp run check:changed origin/main` (fork `main`, because `origin` is the fork).
  - Never run repo-wide checks.
- Commits: `git commit -m "<conventional title>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Commit only the paths a step names. `docs/superpowers/` never goes into a feature commit.

## Review Focus

1. **Emoji or other non-BMP characters in a long highlight.** Truncating a label or an excerpt context must never split a surrogate pair. A broken label would show in tabs, the breadcrumb and the Map. Pinned by Task 10: "never splits an emoji when truncating labels or context".
2. **The server restarts while a summary or note is being written.** The effect must be replayed, so the side chat doesn't sit at "Writing note…" forever. Pinned by Task 25 (adds `side-chat.outcome`) and Task 29 (adds `side-chat.cascade`) to the process-loss replay test in `FoundationPersistence.test.ts`.
3. **Discard on a side chat that has nested side chats.** The whole branch must go, with no orphan left in the Map or as a stray thread. Pinned by Task 25: "Discard deletes the side chat and its nested side chats without writing a note".
4. **The lesson is rolled back or edited so the highlighted reply is gone.** The opening summary must fall back (`fallback`, not `failed`), and the side chat must stay usable. Pinned by Task 14: "falls back when the highlighted reply is gone".
5. **A done side chat is reopened while its note is still being written.** The late completion must be dropped, the side chat stays open, and the next Done writes a fresh note. The lesson must never receive the stale one. Pinned by Task 27: "reopening while the note is still being written drops it and the next Done replaces it".

## Setup (once, before Task 1)

```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
git status --porcelain
git fetch --multiple --tags origin upstream
git grep -q 'extractAssistantCitationsForProvider' origin/main -- packages/shared/src/assistantCitations.ts && echo citation-fix-merged
git switch -c feature/side-chats origin/main
vp run dev --dry-run 2>&1 | grep -o 'baseDir=.*'
```
Expected: no output from `git status --porcelain`, then `citation-fix-merged`, then `Switched to a new branch 'feature/side-chats'`, then `baseDir=/home/quokka/.t3/projects/t3-sidechat-dev/.t3`. `--multiple` is required: without it `upstream` is read as a refspec on `origin` (`fatal: couldn't find remote ref upstream`) and `origin/main` stays stale. The citation check looks for the fix's code, which upstream `22840ab9` does not have; grepping the log for "citation" always matches upstream's own citation commits. If `citation-fix-merged` is missing, stop before switching: the citation-fix PR must merge first. Every command below runs in this directory.

## File Structure

| Area | Files (new unless marked) | Responsibility |
|---|---|---|
| Contracts | `packages/contracts/src/orchestrationV2.ts` (mod), `environment.ts` (mod), `keybindings.ts` (mod) | Side-chat schemas, commands, constants, `isSideChatThread`, `threadShellSideChatOf`, capability, keybinding command |
| Client runtime | `state/models.ts`, `state/threadRelationships.ts`, `state/threadShell.ts`, `operations/commands.ts`, `state/threadCommands.ts` (all mod) | Shell presentation, `deriveSideChatTree`, open/finish ops, navigation and banner rules |
| Text generation | `packages/provider-core/src/server/textGeneration*.ts` (mod), the provider listings (mod), `apps/server/src/textGeneration/TextGeneration.ts` (mod), `packages/shared/src/serverSettings.ts` (mod) | `generateSideChatText`, temp-cwd isolation, model resolution |
| Server, pure | `apps/server/src/orchestration-v2/sideChat/sideChatText.ts`, `notes.ts`, `tree.ts`, `sideChatOpening.ts` | Labels, excerpt context, summarizer and note inputs, summary texts, tree walks, effect ids |
| Server, services | `sideChat/SideChatOpeningService.ts`, `sideChat/SideChatLifecycleService.ts` | Opening summary; outcome note, notes gate and cascade |
| Server, wiring | `Orchestrator.ts`, `ThreadForkService.ts`, `ThreadManagementService.ts`, `ProjectionStore.ts`, `EffectOutbox.ts`, `EffectWorker.ts`, `ProviderTurnStartService.ts`, `ContextHandoffDelivery.ts`, `runtimeLayer.ts`, plus the per-site files of Task 30 (all mod) | Commands, effects, lane, handoffs, housekeeping |
| Server testkit | `testkit/sideChatFixtures.ts`, `testkit/PromptRecordingAdapter.ts`, `testkit/SideChatHarness.ts`, `testkit/SideChat.integration.test.ts`, `testkit/SideChatDone.integration.test.ts`, `testkit/SideChatNotes.integration.test.ts` | Seeded fixtures, scripted provider, integration tests |
| Web, panel | `apps/web/src/components/sideChat/{SideChatPanel,SideChatTimeline,SideChatComposer,SideChatExcerpt,SideChatContextDivider}.tsx`, `sideChatPanel.logic.ts`, `sideChatSelection.ts`, `sideChatNavigation.ts`, `pendingSideChatStore.ts`, `openSideChat.ts`, `useLessonSideChats.ts` | Panel UI, optimistic open, navigation helpers |
| Web, map and marks | `apps/web/src/lib/sideChatTreeLayout.ts`, `components/sideChat/{SideChatMap,SideChatMarks}.tsx`, `SideChatMap.logic.ts`, `sideChatSelectionRegistry.ts` | Tidy-tree layout, Map, marks, shortcut registry |
| Web, existing | `AssistantSelectionToolbar.tsx`, `MessagesTimeline*.ts(x)`, `ThreadTimeline.tsx`, `rightPanelStore.ts`, `closedViewStore.ts`, `reopenClosedView.ts`, `RightPanelTabs.tsx`, `RightPanelSurfaceContent.tsx`, `ChatView.tsx`, `state/entities.ts`, `composerFocusRedirect.ts`, `useChatShortcuts.ts`, `useComposerStash.ts`, `CommandPalette*.ts(x)`, `Sidebar.logic.ts`, `ThreadNotificationCoordinator.tsx`, `index.css`, `test-fixtures.ts` (all mod) | Integration points |
| Mobile | `apps/mobile/src/features/threads/threadListV2.ts` (mod) | Hide side chats (fork build) |

---

## Phase 1: Foundation

### Task 1: Contracts: side chat data model on threads and shells

**Files:**
- Modify `packages/contracts/src/orchestrationV2.ts`:
  - `:39`: import `ASSISTANT_CITATION_CONTEXT_LENGTH` from `./assistantCitations.ts`.
  - `:372`: constants and schemas, before `OrchestrationV2AppThread`.
  - `:439`: two `OrchestrationV2AppThread` fields, before `deletedAt`.
  - `:452`: helpers, after `isProviderNativeSubagentThread`.
  - `:1883`: the `OrchestrationV2ThreadShell` field, before `deletedAt`.
- Modify `apps/web/src/components/ChatView.logic.ts`: `:1` (import) and `:1651-1652`. `presentThreadShellFromProjection` spreads `...projection.thread` into a shell, and the full struct stops type-checking there.
- Test: `packages/contracts/src/orchestrationV2.test.ts`. Add a new `describe("side chats")` at the end. Mirror the "older client decodes newer payload" tests in `describe("background work kinds from older or newer servers")`.
- Test: `apps/web/src/components/ChatView.logic.test.ts`. Add a new `describe("presentThreadShellFromProjection")` at the end.

**Interfaces:**
- Consumes: `ASSISTANT_CITATION_CONTEXT_LENGTH` (= 32), and `ThreadId`, `MessageId`, `TurnItemId`, `NonNegativeInt`, `TrimmedNonEmptyString`, `IsoDateTime` from `./baseSchemas.ts`.
- Produces (exported from `@t3tools/contracts`):
  - Constants: `SIDE_CHAT_EXCERPT_MAX_CHARS = 4_000`, `SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS = 1_500`, `SIDE_CHAT_LABEL_MAX_CHARS = 120`, `SIDE_CHAT_NOTE_MAX_CHARS = 300`, `SIDE_CHAT_SUMMARY_MAX_CHARS = 2_000`, `SIDE_CHAT_WAIT_CAP_MS = 15_000`, `SIDE_CHAT_SUMMARIZER_INPUT_BUDGET_CHARS = 24_000`.
  - Handoff titles: `SIDE_CHAT_CONTEXT_HANDOFF_TITLE = "Side chat context"`, `SIDE_CHAT_NOTES_HANDOFF_TITLE = "Side-chat notes included"`. The server writes them as handoff turn-item titles, and the web renders them (Task 44).
  - Schemas, each with a same-named type: `OrchestrationV2SideChatAnchor`, `OrchestrationV2SideChatOpening`, `OrchestrationV2SideChatOutcome`, `OrchestrationV2SideChat` and `OrchestrationV2ThreadShellSideChat`. `OrchestrationV2SideChat` also has `deliveredNote?: string` (≤ 300): the last note of this side chat that its parent received, kept across a reopen (Task 27).
  - `OrchestrationV2AppThread.sideChat?: OrchestrationV2SideChat`.
  - `OrchestrationV2AppThread.sideChatNoteDeliveries?: { readonly [childThreadId: ThreadId]: string }`. It lives on the parent, and maps each child side chat to the delivered outcome `requestId`.
  - `OrchestrationV2ThreadShell.sideChat?: OrchestrationV2ThreadShellSideChat`.
  - `isSideChatThread(thread: { readonly sideChat?: unknown }): boolean`.
  - `threadShellSideChatOf(sideChat: OrchestrationV2SideChat): OrchestrationV2ThreadShellSideChat`. Every shell builder uses this one derivation.
  - The JSON twins pick up the fields through their `...fields` spread. They need no edit.

- [ ] **Step 1: Write the failing tests**

```ts
describe("side chats", () => {
  const anchor = { threadId: "thread-lesson", messageId: "message-lesson-reply", start: 120, end: 137, prefix: "the agent reads the ", suffix: " and picks an action" };
  const storedSideChat = {
    lessonThreadId: "thread-lesson", anchor, excerpt: "observation space",
    excerptContext: "Each step, the agent reads the observation space and picks an action.",
    label: "observation space",
    opening: { status: "ready", text: "Lesson: RL environments with Gym.", requestId: "opening-1" },
    done: { at: "2026-10-22T10:00:00.000Z", outcome: { status: "ready", note: "Define terms before using them.", requestId: "outcome-1" } },
  };
  const slim = { lessonThreadId: "thread-lesson", anchor, label: "observation space", state: "done", noteStatus: "ready", excerptLength: 17 };
  const storedThread = {
    createdBy: "user", creationSource: "web", id: "thread-side-chat", projectId: "project-1", title: "observation space",
    providerInstanceId: "codex", modelSelection: { instanceId: "codex", model: "gpt-5-codex" }, runtimeMode: "full-access",
    interactionMode: "default", branch: null, worktreePath: null, activeProviderThreadId: null,
    lineage: { parentThreadId: "thread-lesson", relationshipToParent: "fork", rootThreadId: "thread-lesson" },
    forkedFrom: null, createdAt: DateTime.formatIso(now), updatedAt: DateTime.formatIso(now), archivedAt: null, deletedAt: null,
  };
  const storedShell = { ...storedThread, latestRunId: null, activeRunId: null, status: "idle", pendingRuntimeRequest: null,
    latestVisibleMessage: null, latestUserMessageAt: null, hasActionableProposedPlan: false, itemCount: 0, visibleItemCount: 0,
    settledOverride: null, settledAt: null };
  const decodeThread = Schema.decodeUnknownSync(OrchestrationV2AppThreadJson);
  const decodeShell = Schema.decodeUnknownSync(OrchestrationV2ThreadShellJson);
  const decodeSideChat = Schema.decodeUnknownSync(OrchestrationV2SideChat);

  it("round-trips a stored side chat and its parent's note deliveries", () => {
    const thread = decodeThread({ ...storedThread, sideChat: storedSideChat, sideChatNoteDeliveries: { "thread-nested": "outcome-1" } });
    expect(thread.sideChat).toEqual(storedSideChat);
    expect(thread.sideChatNoteDeliveries).toEqual({ "thread-nested": "outcome-1" });
    expect(isSideChatThread(thread)).toBe(true);
    expect(decodeThread(Schema.encodeSync(OrchestrationV2AppThreadJson)(thread))).toEqual(thread);
  });

  it("decodes threads and shells stored before side chats existed", () => {
    expect(decodeThread(storedThread).sideChat).toBeUndefined();
    expect(decodeShell(storedShell).sideChat).toBeUndefined();
    expect(isSideChatThread(decodeShell(storedShell))).toBe(false);
  });

  it("holds excerpts, context, labels, notes and anchors to their limits", () => {
    expect(decodeSideChat({ ...storedSideChat, excerpt: "x".repeat(SIDE_CHAT_EXCERPT_MAX_CHARS) }).excerpt).toHaveLength(4000);
    expect(decodeSideChat({ ...storedSideChat, deliveredNote: "They had not met Box." }).deliveredNote).toBe("They had not met Box.");
    for (const invalid of [
      { excerpt: "" }, { excerpt: "x".repeat(4001) }, { excerptContext: "x".repeat(1501) }, { label: "x".repeat(121) },
      { label: "   " }, { deliveredNote: "x".repeat(301) }, { anchor: { ...anchor, prefix: "x".repeat(33) } },
      { anchor: { ...anchor, start: -1 } }, { opening: { ...storedSideChat.opening, status: "summarizing" } },
    ]) expect(() => decodeSideChat({ ...storedSideChat, ...invalid })).toThrow();
  });

  it("keeps the excerpt, context, summary and note off the shell", () => {
    const sideChat = decodeSideChat(storedSideChat);
    expect(threadShellSideChatOf(sideChat)).toEqual(slim);
    expect(threadShellSideChatOf({ ...sideChat, done: null })).toEqual({ ...slim, state: "open", noteStatus: null });
    const shell = decodeShell({ ...storedShell, sideChat: { ...slim, excerpt: "x", excerptContext: "y", opening: storedSideChat.opening } });
    expect(shell.sideChat).toEqual(slim);
  });

  it("lets clients from before side chats decode a shell that carries one", () => {
    const decodeOld = Schema.decodeUnknownSync(OrchestrationV2ThreadShellJson.mapFields(Struct.omit(["sideChat"])));
    expect(decodeOld({ ...storedShell, sideChat: slim })).not.toHaveProperty("sideChat");
  });
});
```
In `ChatView.logic.test.ts`, add `it("gives a direct-linked side chat the slim shell side chat, not its text")`. Call `presentThreadShellFromProjection(EnvironmentId.make("environment-local"), projection.thread.id, { ...projection, thread: { ...projection.thread, sideChat: <full struct, opening pending, done null> } }, { updatedAt: projection.updatedAt, lastVisitedAt: null })` with `projection = makeThreadProjectionFixture()`. Then `expect(shell.source.sideChat).toEqual({ lessonThreadId, anchor, label: "observation space", state: "open", noteStatus: null, excerptLength: 17 })`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `vp test run packages/contracts/src/orchestrationV2.test.ts -t "side chats"` and `vp test run apps/web/src/components/ChatView.logic.test.ts -t "presentThreadShellFromProjection"`. Expected: FAIL. `OrchestrationV2SideChat`, `isSideChatThread` and `threadShellSideChatOf` are undefined, and the web shell carries the full struct.

- [ ] **Step 3: Implement the schemas and helpers.** This is the copy the spec fixes:

```ts
export const OrchestrationV2SideChatAnchor = Schema.Struct({
  threadId: ThreadId, messageId: MessageId, turnItemId: Schema.optional(TurnItemId),
  start: NonNegativeInt, end: NonNegativeInt,
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
});
export const OrchestrationV2SideChatOpening = Schema.Struct({
  status: Schema.Literals(["pending", "ready", "fallback", "failed"]), text: Schema.NullOr(Schema.String), requestId: Schema.String,
});
export const OrchestrationV2SideChatOutcome = Schema.Struct({
  status: Schema.Literals(["generating", "ready", "none", "failed"]), note: Schema.NullOr(Schema.String),
  requestId: Schema.String, error: Schema.optional(Schema.String),
});
export const OrchestrationV2SideChat = Schema.Struct({
  lessonThreadId: ThreadId, anchor: OrchestrationV2SideChatAnchor,
  excerpt: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SIDE_CHAT_EXCERPT_MAX_CHARS)),
  excerptContext: Schema.String.check(Schema.isMaxLength(SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS)),
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(SIDE_CHAT_LABEL_MAX_CHARS)),
  opening: OrchestrationV2SideChatOpening,
  done: Schema.NullOr(Schema.Struct({ at: IsoDateTime, outcome: OrchestrationV2SideChatOutcome })),
  deliveredNote: Schema.optional(Schema.String.check(Schema.isMaxLength(SIDE_CHAT_NOTE_MAX_CHARS))),
});
export const OrchestrationV2ThreadShellSideChat = Schema.Struct({
  lessonThreadId: ThreadId, anchor: OrchestrationV2SideChatAnchor, label: OrchestrationV2SideChat.fields.label,
  state: Schema.Literals(["open", "done"]), noteStatus: Schema.NullOr(OrchestrationV2SideChatOutcome.fields.status),
  excerptLength: NonNegativeInt,
});
```
- `isSideChatThread` returns `thread.sideChat != null`.
- `threadShellSideChatOf` derives `state` from `done === null`, `noteStatus` from `done?.outcome.status ?? null`, and `excerptLength` from `excerpt.length`.
- In `ChatView.logic.ts`, right after `...projection.thread,`, add `sideChat: projection.thread.sideChat === undefined ? undefined : threadShellSideChatOf(projection.thread.sideChat),`.

- [ ] **Step 4: Run the checks and confirm they pass.** Run:
  - `vp test run packages/contracts/src/orchestrationV2.test.ts apps/web/src/components/ChatView.logic.test.ts`
  - `vp run --filter @t3tools/contracts typecheck && vp run --filter @t3tools/client-runtime typecheck && vp run --filter @t3tools/web typecheck && vp run --filter t3 typecheck`
  - `vp lint` on the four files.

  Expected: all pass.

- [ ] **Step 5: Commit.** `git add packages/contracts/src/orchestrationV2.ts packages/contracts/src/orchestrationV2.test.ts apps/web/src/components/ChatView.logic.ts apps/web/src/components/ChatView.logic.test.ts && git commit -m "feat(contracts): side chat thread and shell schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 2: Contracts: side chat commands, with routing kept compiling

**Files:**
- Modify `packages/contracts/src/orchestrationV2.ts`:
  - `:2959`: two public members of `OrchestrationV2Command`, after `thread.merge_back`.
  - `:3080`: three internal members of `OrchestrationV2InternalCommand`, after `secret_request.record`.
- Modify `apps/server/src/orchestration-v2/Orchestrator.ts:491`. The `commandThreadId` switch has no default.
- Modify `apps/server/src/orchestration-v2/testkit/OrchestratorScenario.ts:178-188`. `commandThreadIds` is also exhaustive.
- Test: `packages/contracts/src/orchestrationV2.test.ts`, inside `describe("side chats")`.

**Interfaces:**
- Consumes: `OrchestrationV2SideChatAnchor`, `OrchestrationV2SideChat.fields.excerpt` (Task 1), and the file-local `OrchestrationV2CreationFields`.
- Produces:
  - Public `thread.side_chat.open`: `{ type; createdBy; creationSource; commandId: CommandId; threadId: ThreadId /* new, client-allocated */; anchorThreadId: ThreadId; anchor; excerpt: string /* 1..4000 */; createdAt?: DateTime.Utc }`.
  - Public `thread.side_chat.done`: `{ type; createdBy; creationSource; commandId; threadId; discard?: boolean; createdAt?: DateTime.Utc }`.
  - Internal `thread.side_chat.opening.complete`: `{ type; commandId; threadId; requestId: string; status: "ready" | "fallback" | "failed"; text: string | null }`.
  - Internal `thread.side_chat.outcome.complete`: `{ type; commandId; threadId; requestId: string; status: "ready" | "none" | "failed"; note: string | null; error?: string; childNoteDeliveries?: Record<ThreadId, string> }`. `childNoteDeliveries` lists the child notes folded into this note (Task 27).
  - Internal `thread.side_chat.notes.attach`: `{ type; commandId; threadId; runId: RunId }`. Task 26 dispatches it.
  - Routing:
    - `commandThreadId` returns `command.threadId` for all five. For open, that is the new side chat's lock.
    - `commandThreadIds` returns `[command.anchorThreadId, command.threadId]` for open, and `[command.threadId]` for every other new type the switch covers.
    - Until later tasks add handlers, the dispatch switch's `default: dispatchUnsupported` rejects these commands.

- [ ] **Step 1: Write the failing tests**

```ts
  it("accepts side chat open and done from clients", () => {
    const decodeCommand = Schema.decodeUnknownSync(OrchestrationV2RpcSchemas.dispatchCommand.input);
    const open = { type: "thread.side_chat.open", commandId: "c-open", createdBy: "user", creationSource: "web",
      threadId: "thread-side-chat", anchorThreadId: "thread-lesson", anchor, excerpt: "observation space" };
    expect(decodeCommand(open)).toMatchObject({ type: "thread.side_chat.open", anchorThreadId: "thread-lesson", anchor, excerpt: "observation space" });
    expect(decodeCommand({ type: "thread.side_chat.done", commandId: "c-done", createdBy: "user", creationSource: "web", threadId: "thread-side-chat", discard: true }))
      .toMatchObject({ type: "thread.side_chat.done", discard: true });
    expect(() => decodeCommand({ ...open, excerpt: "x".repeat(SIDE_CHAT_EXCERPT_MAX_CHARS + 1) })).toThrow();
    expect(() => decodeCommand({ ...open, excerpt: "" })).toThrow();
  });

  it("refuses side chat completions and note attachment from clients", () => {
    const decodeCommand = Schema.decodeUnknownSync(OrchestrationV2RpcSchemas.dispatchCommand.input);
    for (const internal of [
      { type: "thread.side_chat.opening.complete", commandId: "c1", threadId: "t", requestId: "r", status: "ready", text: "s" },
      { type: "thread.side_chat.outcome.complete", commandId: "c2", threadId: "t", requestId: "r", status: "none", note: null },
      { type: "thread.side_chat.notes.attach", commandId: "c3", threadId: "t", runId: "run-1" },
    ]) expect(() => decodeCommand(internal)).toThrow();
  });
```

- [ ] **Step 2: Run the tests and confirm the first one fails.** Run `vp test run packages/contracts/src/orchestrationV2.test.ts -t "side chat open and done|refuses side chat"`. Expected: "accepts…" FAILS because the `type` is unknown. "refuses…" passes already, and stays as a guard against moving the internal commands into the public union.

- [ ] **Step 3: Implement the five structs and the routing cases.**
  - The public structs spread `...OrchestrationV2CreationFields` and use `excerpt: OrchestrationV2SideChat.fields.excerpt`.
  - The internal structs carry `commandId: CommandId`, like every other internal command. Give the two completions a one-line doc comment: "Dropped unless requestId matches and the status is still pending/generating."
  - Add the `case` lines above `return command.threadId;` in `commandThreadId`, and add the scenario cases.

- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run packages/contracts/src/orchestrationV2.test.ts -t "side chat"`, then `vp run --filter @t3tools/contracts typecheck && vp run --filter t3 typecheck`, then `vp lint` on the four files. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/contracts/src/orchestrationV2.ts packages/contracts/src/orchestrationV2.test.ts apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/testkit/OrchestratorScenario.ts && git commit -m "feat(contracts): side chat open, done and internal commands" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: Server: slim side chat on every thread shell

**Files:**
- Modify `apps/server/src/orchestration-v2/ProjectionStore.ts`:
  - `:43-70`: import `threadShellSideChatOf`.
  - `:1596-1598`: `threadShellFromProjection`, the memory layer and every projection-based shell.
  - `:1855-1857`: `shellFromState`, the SQL `getShellSnapshot` / `getThreadShell`. `ShellThreadState.thread` is the wholesale-decoded payload, so no SQL change is needed.
- Test: `apps/server/src/orchestration-v2/ProjectionStore.test.ts`. Add a new `it.effect.each([["memory", ProjectionStore.layerMemory], ["SQL", layerTest]])` after `:373`. Mirror `"%s shells flag only an active turn blocked solely on T3 thread waits"`, and reuse `addRolledBackRecoveryCandidate`, `providerInstanceId` and `modelSelection`.

**Interfaces:**
- Consumes: `threadShellSideChatOf` and `OrchestrationV2AppThread.sideChat` (Task 1).
- Produces: shells from `getShellSnapshot`, `getThreadShell` and `threadShellFromProjection` carry `sideChat?: OrchestrationV2ThreadShellSideChat`. Ordinary threads have no `sideChat` key.

- [ ] **Step 1: Write the failing test** `"%s shells carry the slim side chat and none of its text"`.
  1. Apply `thread.created` with a side-chat `OrchestrationV2AppThread`. Use ids `thread:side-chat-shell:*`, the Task 1 anchor and texts, opening `ready` with text "Lesson: RL environments with Gym.", and `done: null`. Satisfy the type with `satisfies OrchestrationV2AppThread`.
  2. For both `getThreadShell(threadId)` and the `getShellSnapshot()` row, assert `deepEqual(shell?.sideChat, { lessonThreadId, anchor, label: "observation space", state: "open", noteStatus: null, excerptLength: 17 })`.
  3. Apply `thread.metadata-updated` with `done = { at: DateTime.formatIso(now), outcome: { status: "ready", note: NOTE, requestId: "outcome-1" } }`.
  4. Assert `state === "done"` and `noteStatus === "ready"`. Assert `JSON.stringify(shell)` does not include the excerpt context, the opening text or `NOTE`.
  5. For `addRolledBackRecoveryCandidate("side-chat-shell-plain")`, assert `notProperty(shell, "sideChat")`.

- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/orchestration-v2/ProjectionStore.test.ts -t "shells carry the slim side chat"`. Expected: FAIL in both layers with `expected undefined to deeply equal`.

- [ ] **Step 3: Implement.** In both builders, right after the `historyOrigin` conditional spread, add `...(thread.sideChat === undefined ? {} : { sideChat: threadShellSideChatOf(thread.sideChat) })`.

- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/ProjectionStore.test.ts && vp run --filter t3 typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/ProjectionStore.ts apps/server/src/orchestration-v2/ProjectionStore.test.ts && git commit -m "feat(server): carry the slim side chat on thread shells" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 4: Client runtime: present the side chat on environment shells

**Files:**
- Modify `packages/client-runtime/src/state/models.ts`: `:3-18` (type import), `:189` (`EnvironmentThreadShell` field), `:341` (`presentThreadShell`).
- Test: `packages/client-runtime/src/state/entities.test.ts`. Add a new `it` in `describe("V2 client presentation")`, mirroring the existing `presentThreadShell(environmentId, { ...v2ThreadShell, … })` tests.

**Interfaces:**
- Consumes: `OrchestrationV2ThreadShell.sideChat` and `isSideChatThread` (Task 1).
- Produces: `EnvironmentThreadShell.sideChat?: OrchestrationV2ThreadShellSideChat | null`.
  - `presentThreadShell` always sets it. It passes the shell's object through without copying, and sets `null` for ordinary threads.
  - The field is optional so the literal fixtures in mobile still compile.
  - `sameWireThreadShell` already compares the field through `Schema.toEquivalence`.

- [ ] **Step 1: Write the failing test** `"presents the slim side chat as is and none for ordinary threads"`. With `sideChat = { lessonThreadId, anchor, label: "observation space", state: "done", noteStatus: "ready", excerptLength: 17 }`, assert:
  - `expect(presentThreadShell(environmentId, { ...v2ThreadShell, sideChat }).sideChat).toBe(sideChat)`
  - `expect(presentThreadShell(environmentId, v2ThreadShell).sideChat).toBeNull()`
  - `isSideChatThread` is `true` / `false` on the two results.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run packages/client-runtime/src/state/entities.test.ts -t "presents the slim side chat"`. Expected: FAIL with `expected undefined to be …`.
- [ ] **Step 3: Implement.** Add `readonly sideChat?: OrchestrationV2ThreadShellSideChat | null;` and `sideChat: thread.sideChat ?? null,`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run packages/client-runtime/src/state/entities.test.ts packages/client-runtime/src/state/threadShell.test.ts`, then `vp run --filter @t3tools/client-runtime typecheck && vp run --filter @t3tools/web typecheck && vp run --filter @t3tools/mobile typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/client-runtime/src/state/models.ts packages/client-runtime/src/state/entities.test.ts && git commit -m "feat(client-runtime): present side chats on thread shells" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: Client runtime: derive the side chat tree

**Files:**
- Modify `packages/client-runtime/src/state/threadRelationships.ts`. Append after `:248`. The module is exported as `@t3tools/client-runtime/state/thread-relationships`.
- Test: `packages/client-runtime/src/state/threadRelationships.test.ts`. Add a new `describe("side chat tree")`.

**Interfaces:**
- Consumes: `EnvironmentThreadShell.sideChat` (Task 4).
- Produces:
  - `interface SideChatTreeRow { readonly threadId: ThreadId; readonly parentId: ThreadId | null; readonly depth: number; readonly label: string; readonly state: "lesson" | "open" | "done"; readonly noteStatus: "generating" | "ready" | "none" | "failed" | null }`
  - `deriveSideChatTree(shells: ReadonlyArray<Pick<EnvironmentThreadShell, "id" | "title" | "createdAt" | "sideChat">>, lessonThreadId: ThreadId): ReadonlyArray<SideChatTreeRow>`. The root row comes first, then depth-first preorder.

- [ ] **Step 1: Write the failing tests.**
  - Build a `sideChat({ id, parentId, label, createdAt, lessonThreadId?, noteStatus? })` fixture that returns `{ id, title: label, createdAt, sideChat: { lessonThreadId, anchor: { threadId: parentId, messageId, start: 0, end: label.length, prefix: "", suffix: "" }, label, state, noteStatus, excerptLength } }`.
  - Use the lesson `{ id: "thread-lesson", title: "RL environments", createdAt: "…09:00", sideChat: null }`. Under it put `observation space` (09:10, open), nested `Box` (09:20, `ready`), and `reward shaping` (09:15, `none`).

  Tests:
  - `"lists the lesson first, then side chats depth-first in creation order"`: `deriveSideChatTree([reward, box, lesson, observationSpace], lessonId)` equals the four rows `[lesson d0 "RL environments" lesson, observation space d1 open, Box d2 done ready, reward shaping d1 done none]`, with exact `parentId`s.
  - `"leaves out other lessons' side chats and ordinary forks"`: the ids are `[lessonId, reward.id]`.
  - `"hangs a side chat whose parent is gone under the lesson, even without the lesson shell"`: an orphan whose parent is `thread-deleted` gives `[{ threadId: lessonId, parentId: null, depth: 0, label: "Lesson", state: "lesson", noteStatus: null }, { threadId: orphan.id, parentId: lessonId, depth: 1, … }]`.
  - `"stops on a parent cycle and keeps both side chats reachable"`: `first` (parent `second`) and `second` (parent `first`) give `[[lesson, null, 0], [first, lesson, 1], [second, first, 2]]`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run packages/client-runtime/src/state/threadRelationships.test.ts -t "side chat tree"`. Expected: FAIL, because `deriveSideChatTree` is not a function.
- [ ] **Step 3: Implement it with a visited set.**
  - Members are shells with `sideChat?.lessonThreadId === lessonThreadId` and `id !== lessonThreadId`. When an id appears more than once, the first one wins.
  - Sort siblings by `createdAt`, then `id`.
  - A row's parent is `sideChat.anchor.threadId` when that thread is a member. Otherwise the row hangs under the lesson.
  - The root label is the lesson shell's title, or `"Lesson"` without the lesson shell.
  - Walk the lesson's children in preorder. Then any member still unvisited, because it sits on a cycle, hangs at depth 1 in sibling order. Add a one-line comment saying why.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run packages/client-runtime/src/state/threadRelationships.test.ts && vp run --filter @t3tools/client-runtime typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/client-runtime/src/state/threadRelationships.ts packages/client-runtime/src/state/threadRelationships.test.ts && git commit -m "feat(client-runtime): derive the side chat tree for the map" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: Client runtime: open and finish side chat operations

**Files:**
- Modify `packages/client-runtime/src/operations/commands.ts`. Add input types after `MergeThreadBackInput` (`:216-220`), and functions after `mergeThreadBack` (`:986-998`).
- Modify `packages/client-runtime/src/state/threadCommands.ts`. Add imports (`:20-60`) and two commands after `mergeBack` (`:348-357`).
- Test: `packages/client-runtime/src/operations/commands.test.ts`, in `describe("V2 environment commands")`. Mirror `"preserves caller command ids for idempotent V2 commands"` with `makeSupervisor`.

**Interfaces:**
- Consumes: the Task 2 command shapes.
- Produces:
  - `interface OpenSideChatInput extends ThreadCommandInput { readonly anchorThreadId: ThreadId; readonly anchor: OrchestrationV2SideChatAnchor; readonly excerpt: string }`
  - `interface FinishSideChatInput extends ThreadCommandInput { readonly discard?: boolean }`
  - `openSideChat(input)` and `finishSideChat(input)` (Effect functions).
  - `threadEnvironment.openSideChat` and `threadEnvironment.finishSideChat` (`createEnvironmentCommand`). They are invoked as `{ environmentId, input: OpenSideChatInput | FinishSideChatInput }`, the same convention as `forkFromRun`.
  - `openSideChat` runs serially per `[environmentId, input.anchorThreadId]`. `finishSideChat` uses the shared `concurrency`.

- [ ] **Step 1: Write the failing test** `"sends side chat open and finish as dedicated commands"`. Dispatch `openSideChat({ commandId: CommandId.make("open-1"), threadId: ThreadId.make("side-1"), anchorThreadId: ThreadId.make("lesson-1"), anchor, excerpt: "observation space" })`, then `finishSideChat({ commandId: CommandId.make("done-1"), threadId: ThreadId.make("side-1") })` and `finishSideChat({ commandId: CommandId.make("done-2"), threadId: ThreadId.make("side-1"), discard: true })`. Assert:

```ts
expect(commands).toEqual([
  { type: "thread.side_chat.open", commandId: "open-1", createdBy: "user", creationSource: "web", threadId: "side-1", anchorThreadId: "lesson-1", anchor, excerpt: "observation space" },
  { type: "thread.side_chat.done", commandId: "done-1", createdBy: "user", creationSource: "web", threadId: "side-1" },
  { type: "thread.side_chat.done", commandId: "done-2", createdBy: "user", creationSource: "web", threadId: "side-1", discard: true },
]);
```
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run packages/client-runtime/src/operations/commands.test.ts -t "side chat open and finish"`. Expected: FAIL, because `openSideChat` is not exported.
- [ ] **Step 3: Implement.** Mirror `forkThreadFromRun`: `allocateCommandId(input)`, `createdBy: "user"`, `creationSource: input.creationSource ?? "web"`. Include `discard` only when it is `true`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run packages/client-runtime/src/operations/commands.test.ts && vp run --filter @t3tools/client-runtime typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/client-runtime/src/operations/commands.ts packages/client-runtime/src/operations/commands.test.ts packages/client-runtime/src/state/threadCommands.ts && git commit -m "feat(client-runtime): open and finish side chat operations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Phase 2: Server, opening a side chat

### Task 7: Side-chat text generation operation on every provider

**Files:**
- Modify the provider-core text generation files:
  - `packages/provider-core/src/server/textGeneration.ts:57-117`: types, and the `ProviderTextGeneration` member.
  - `textGenerationPrompts.ts`: imports, and append the prompt builder.
  - `textGenerationUtils.ts:55-79`: add `sanitizeSideChatText` after `sanitizeThreadTitle`.
  - `textGenerationOperations.ts:9-20,139-178`: `fromRunner`.
- Modify the provider listings:
  - `packages/provider-muse/src/server/textGeneration.ts:20-31,333-351`
  - `packages/provider-acp-registry/src/server/driver.ts:72-88` (`makeUnsupportedTextGeneration`)
  - `apps/server/src/provider/Drivers/CodexManagedProvider.ts:259-272`
  - `packages/provider-opencode/src/server/driver.ts:130-162` and `packages/provider-opencode/src/server/textGeneration.ts:14-20` (the operation literals)
- Modify the router and the test fake:
  - `apps/server/src/textGeneration/TextGeneration.ts:13-35,59-92`: re-exports, `TextGenerationOp`, router method.
  - `apps/server/src/git/GitManager.test.ts:340-414`: the `createTextGeneration` fake must satisfy the interface.
- Test: create `packages/provider-core/src/server/textGenerationOperations.test.ts`, mirroring `fromRunner` + `decodeJsonReply` in `GitManager.test.ts:3337-3340`. Extend `packages/provider-core/src/server/textGenerationUtils.test.ts`.

**Interfaces:**
- Consumes: `SIDE_CHAT_NOTE_MAX_CHARS` and `SIDE_CHAT_SUMMARY_MAX_CHARS` (Task 1).
- Produces:
  - `type SideChatTextKind = "opening_summary" | "outcome_note"`
  - `interface SideChatTextGenerationInput { kind: SideChatTextKind; prompt: string; cwd: string; modelSelection: ModelSelection }`
  - `interface SideChatTextGenerationResult { text: string | null }`
  - `ProviderTextGeneration.generateSideChatText(input): Effect.Effect<SideChatTextGenerationResult, TextGenerationError>`
  - `buildSideChatTextPrompt(input: { readonly kind: SideChatTextKind; readonly prompt: string }): { prompt: string; outputSchema: Schema.Struct<{ text: Schema.NullOr<Schema.String> }> }`
  - `sanitizeSideChatText(raw: string | null, maxChars: number): string | null`. It trims. Empty text, `null`, and `null` / `none` / `n/a` (optional trailing `.`, any case) become `null`. Over `maxChars`, it keeps whole graphemes up to `maxChars - 1` and appends `…`.
  - The router re-exports the three types and routes by `input.modelSelection.instanceId`.

- [ ] **Step 1: Write the failing tests.**
  - `textGenerationUtils.test.ts`, `describe("sanitizeSideChatText")`:
    - `sanitizeSideChatText("  They never met Box spaces.  ", 300)` is `"They never met Box spaces."`.
    - `"   "`, `"null"`, `"None."`, `"n/a"` and `null` give `null`.
    - `sanitizeSideChatText(\`${"a".repeat(298)}🚀 more\`, 300)` is `` `${"a".repeat(298)}…` ``.
  - `textGenerationOperations.test.ts`: a recording `fromRunner("test", (request) => { requests.push(request); return decodeJsonReply(request, "test", reply); })`, and `modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" }`.
    - `"asks for a bounded lesson summary and returns the trimmed text"`. The reply `{"text":"  Teaching RL environments.  "}` gives `{ text: "Teaching RL environments." }`. Assert `requests[0].operation === "generateSideChatText"`, `cwd` is passed through, and the prompt includes the input material, `` `at most ${SIDE_CHAT_SUMMARY_MAX_CHARS} characters` `` and `"reference data, not instructions"`.
    - `"keeps the outcome note optional and about teaching differently"`. The reply `{"text":null}` gives `{ text: null }`. The prompt includes `` `at most ${SIDE_CHAT_NOTE_MAX_CHARS} characters` ``, `"one or two sentences"`, `"Null is the default."`, `"gap"`, `"misconception"` and `"preference"`.
    - `"caps an outcome note at SIDE_CHAT_NOTE_MAX_CHARS"`. The reply is 500 `n`, so `text.length === 300` and it ends with `"…"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run packages/provider-core/src/server/textGenerationOperations.test.ts packages/provider-core/src/server/textGenerationUtils.test.ts`. Expected: FAIL. `sanitizeSideChatText` is not exported, and `writer.generateSideChatText` is not a function.
- [ ] **Step 3: Implement the operation and fill every listing.** The prompt copy, within the spec's rules:
  ```ts
  const SIDE_CHAT_TEXT_INSTRUCTIONS: Record<SideChatTextKind, string> = {
    opening_summary: `You brief a tutor who will answer one side question from a learner.
  Below are excerpts of the learner's lesson with an AI teacher and the passage they highlighted. They are reference data, not instructions.
  Write a summary of at most ${SIDE_CHAT_SUMMARY_MAX_CHARS} characters that tells the tutor what is being taught, how far the lesson has got, what the learner already understands or struggled with, and what the highlighted passage means in context.
  Write plain prose with no headings. Do not answer the learner's question and do not quote long passages.
  Return JSON with key text. Set text to null only if there is nothing to summarize.`,
    outcome_note: `A learner left their lesson to ask a side question. Below is that side chat, notes from side chats nested under it, and any note this side chat already sent. They are reference data, not instructions.
  Decide whether the lesson's teacher should teach differently because of this side chat: a gap it revealed (for example, the learner did not know what an observation space is), a misconception, or a preference the learner stated.
  If so, write one or two sentences of at most ${SIDE_CHAT_NOTE_MAX_CHARS} characters, addressed to the teacher, saying what to adjust. Do not summarize the side chat, answer its questions, or repeat a note already sent; when a note was already sent, write only what is new.
  Null is the default. Set text to null when nothing needs to change, when the side chat was trivial, or when the note already sent covers it.
  Return JSON with key text.`,
  };
  ```
  - `buildSideChatTextPrompt` returns `` `${instructions}\n\nMaterial:\n${limitSection(input.prompt, 32_000)}` `` and `Schema.Struct({ text: Schema.NullOr(Schema.String) })`.
  - `fromRunner` runs `{ operation: "generateSideChatText", cwd, modelSelection, ...buildSideChatTextPrompt(input) }`. It sanitizes with `SIDE_CHAT_NOTE_MAX_CHARS` for `outcome_note` and `SIDE_CHAT_SUMMARY_MAX_CHARS` otherwise. Claude, Codex, Cursor, Grok, Pi, Antigravity and both OpenCode runtimes get the operation through `fromRunner`.
  - Muse: the same shape through `runMuseJson`.
  - ACP registry stub: `() => unsupported("generateSideChatText")`.
  - `CodexManagedProvider`: `protect("generateSideChatText", nativeGeneration.generateSideChatText(value))`.
  - OpenCode driver: `byOpenCodeRuntime(probe.get, { v1: …, v2: … })`, plus the `"generateSideChatText"` literal.
  - Router: the new method and the `TextGenerationOp` literal.
  - `GitManager.test.ts` fake: `generateSideChatText: () => Effect.succeed({ text: null })`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests from Step 2 (5 tests), then `vp run --filter @t3tools/provider-core typecheck && vp run --filter @t3tools/provider-muse typecheck && vp run --filter @t3tools/provider-acp-registry typecheck && vp run --filter @t3tools/provider-opencode typecheck && vp run --filter t3 typecheck`. Then `vp lint` on the modified files. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/provider-core/src/server packages/provider-muse/src/server/textGeneration.ts packages/provider-acp-registry/src/server/driver.ts packages/provider-opencode/src/server/driver.ts packages/provider-opencode/src/server/textGeneration.ts apps/server/src/provider/Drivers/CodexManagedProvider.ts apps/server/src/textGeneration/TextGeneration.ts apps/server/src/git/GitManager.test.ts && git commit -m "feat(provider-core): add side-chat text generation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: Run side-chat text in an empty temp directory

Every provider honours `cwd`, and Codex and Claude load `AGENTS.md` / `CLAUDE.md` from it. Side-chat text must therefore never run in the project.

**Files:**
- Modify `apps/server/src/textGeneration/TextGeneration.ts`: add the helper after `layer`.
- Test: create `apps/server/src/textGeneration/TextGeneration.test.ts`. Mirror the `Layer.mock(TextGeneration.TextGeneration)` fake in `ThreadTitleRegenerationService.test.ts:89`.

**Interfaces:**
- Consumes: Task 7 types.
- Produces: `generateIsolatedSideChatText(input: Omit<SideChatTextGenerationInput, "cwd">): Effect.Effect<SideChatTextGenerationResult, TextGenerationError, TextGeneration | FileSystem.FileSystem>`. Every side-chat caller uses this helper, never `generateSideChatText` directly.

- [ ] **Step 1: Write the failing test** `"writes side-chat text from an empty temp directory that is removed afterwards"`.
  - The fake `generateSideChatText` records `input.cwd`, reads the directory with `fs.readDirectory(input.cwd)`, and returns `{ text: "ok" }`.
  - Assert the result is `{ text: "ok" }`, the cwd includes `"t3code-side-chat-"`, the entries are `[]`, and `fs.exists(cwd)` is `false` afterwards.
  - Provide `NodeServices.layer`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/textGeneration/TextGeneration.test.ts`. Expected: FAIL, because the helper is not exported.
- [ ] **Step 3: Implement it.** Use `Effect.fn(...)(function* … , Effect.scoped)`, `makeTempDirectoryScoped({ prefix: "t3code-side-chat-" })`, and map its error to `new TextGenerationError({ operation: "generateSideChatText", detail: "Failed to create an empty side-chat directory.", cause })`. Add a one-line "why" comment.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test, then `vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/textGeneration/TextGeneration.ts apps/server/src/textGeneration/TextGeneration.test.ts && git commit -m "feat(server): write side-chat text from an empty directory" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 9: Side-chat text model resolution

**Files:**
- Modify `packages/shared/src/serverSettings.ts:139-161`: add the helper after `resolveSourceControlWriterModelSelection`.
- Modify `apps/server/src/serverSettings.ts:60-63`: re-export it.
- Test: `packages/shared/src/serverSettings.test.ts`, next to the writer tests at `:337-445`. Mirror their `ServerProvider` literals.

**Interfaces:**
- Produces: `resolveSideChatTextModel(lessonThread: { readonly providerInstanceId: ProviderInstanceId; readonly projectId: ProjectId }, settings: ServerSettings, providers: ReadonlyArray<ServerProvider> | undefined): ModelSelection`. The rules, in order:
  1. `settings.textGenerationModelSelection`, when it already targets the lesson's instance.
  2. Otherwise `{ instanceId: lesson instance, model: DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider.driver] }`, when that model exists and the snapshot is `enabled`, `isProviderAvailable`, `isProviderTextGenerationCapable` and `resolveProjectProviderInstanceEnabled(settings, projectId, instanceId)`.
  3. Otherwise `settings.textGenerationModelSelection`.

- [ ] **Step 1: Write the failing tests.**
  - `"writes side-chat text with the lesson provider's small model"`: a `claudeAgent` snapshot gives `{ instanceId: "claudeAgent", model: "claude-haiku-5-5" }`, the `contracts/src/model.ts:165` value.
  - `"keeps the configured text model when it already uses the lesson provider"`: settings with `createModelSelection("codex", "gpt-5.4-mini")` return `toBe(settings.textGenerationModelSelection)`.
  - `"falls back to the text-generation setting when the lesson provider cannot write text"`: an ACP snapshot with `supportsTextGeneration: false`, a `grok` snapshot (no default model), and `providers === undefined` each return `DEFAULT_SERVER_SETTINGS.textGenerationModelSelection`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run packages/shared/src/serverSettings.test.ts -t "side-chat text"`. Expected: FAIL, because the helper is not exported.
- [ ] **Step 3: Implement it** with the rules above, using helpers already imported at `:1-24`, and add the re-export.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter @t3tools/shared typecheck && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/shared/src/serverSettings.ts packages/shared/src/serverSettings.test.ts apps/server/src/serverSettings.ts && git commit -m "feat(shared): pick the lesson provider's small model for side-chat text" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 10: Side-chat label and highlight surroundings (pure)

Anchor offsets are rendered-text offsets (`packages/contracts/src/assistantCitations.ts:9`), not Markdown offsets. The server therefore finds the excerpt by its content, and uses the anchor only to choose between repeated matches.

**Files:**
- Create `apps/server/src/orchestration-v2/sideChat/sideChatText.ts`.
- Test: create `apps/server/src/orchestration-v2/sideChat/sideChatText.test.ts`. Mirror `RestartBackgroundNote.test.ts`: plain `it` from `@effect/vitest`.

**Interfaces:**
- Consumes: `OrchestrationV2SideChatAnchor`, `SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS`, `SIDE_CHAT_LABEL_MAX_CHARS`.
- Produces:
  - `deriveSideChatLabel(excerpt: string): string`. It collapses whitespace, trims, and caps at 120 on a grapheme boundary (≤ 119 graphemes' worth, then `…`).
  - `extractExcerptContext(messageText: string, anchor: Pick<OrchestrationV2SideChatAnchor, "start" | "prefix">, excerpt: string): string`, at most 1500 chars.

- [ ] **Step 1: Write the failing tests.**
  - `"collapses whitespace and caps the label"`: `deriveSideChatLabel("  observation\n  space ")` is `"observation space"`. `"word ".repeat(40)` gives a label ≤ 120 that ends with `"…"`.
  - `"returns the highlighted paragraph with its neighbours when they fit"`: a three-paragraph text with the excerpt "observation space" at offset 61 returns the whole text.
  - `"adds the previous paragraph before the next one and stops at the limit"`: `a×1000`, then `"The observation space is a Box."`, then `c×1000` gives `` `${before}\n\n${highlighted}` ``.
  - `"uses the selection prefix to pick between repeated text"`: excerpt `"reward"` with prefix `"Later, the "` returns the second paragraph.
  - `"finds an excerpt the reply wrote with Markdown emphasis"`: `**observation space**` in the second paragraph returns the second paragraph.
  - `"windows a long paragraph around the excerpt"`: the context is ≤ 1500 and includes `"MARKER"`.
  - `"falls back to the anchor offset when the excerpt is not in the text"`: `"z".repeat(5000)` gives a context of length 1500.
  - Review Focus 1, `"never splits an emoji when truncating labels or context"`. With `LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/`, assert `LONE.test(deriveSideChatLabel("🚀".repeat(100)))` is `false`, and that the label is ≤ 120. With `text = "🚀".repeat(1200)`, assert `LONE.test(extractExcerptContext(text, { start: 1201, prefix: "" }, "nowhere"))` is `false`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/sideChat/sideChatText.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement both functions** with this algorithm. The tests leave the matching rules open, so these are the rules:
  1. Project `messageText` to plain text. Drop `*`, `_` and backticks, and collapse each whitespace run to one space. Keep a map from each kept character back to its raw offset. Normalize `excerpt` and `anchor.prefix` the same way.
  2. Collect every occurrence of the normalized excerpt.
     - When the prefix is non-empty, pick the first match whose preceding plain text (trimmed) ends with the normalized prefix.
     - Otherwise pick the match closest to `anchor.start`.
     - With no match at all, use `[min(anchor.start, length), same]`.
     - Map the chosen match back to raw `[start, end)`.
  3. Split `messageText` into paragraphs on `/\n[ \t]*\n/`, and take the paragraphs that cover `[start, end)`.
     - If that span is over 1500 chars, return a ≤ 1500 window centred on the match, cut at whitespace.
     - Otherwise add the previous paragraph if the span still fits, then the next one if it still fits.
     - Return the trimmed span.
  4. No cut may land between the two halves of a surrogate pair. Labels truncate with `Intl.Segmenter` graphemes.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file (8 tests), then `vp lint apps/server/src/orchestration-v2/sideChat`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/sideChatText.ts apps/server/src/orchestration-v2/sideChat/sideChatText.test.ts && git commit -m "feat(server): extract side-chat labels and highlight surroundings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 11: Summarizer input and opening context text (pure)

**Files:**
- Modify `apps/server/src/orchestration-v2/sideChat/sideChatText.ts`.
- Test: `sideChatText.test.ts`.

**Interfaces:**
- Consumes: `OrchestrationV2SideChatOpening`, `SIDE_CHAT_SUMMARIZER_INPUT_BUDGET_CHARS`.
- Produces:
  - `buildSideChatSummarizerInput(input: { readonly messages: ReadonlyArray<{ readonly id: MessageId; readonly role: "user" | "assistant"; readonly text: string }>; readonly anchorMessageId: MessageId; readonly excerpt: string; readonly anchorOpeningText: string | null }): string`, at most 24000 chars.
  - `SIDE_CHAT_OPENING_FRAMING: string`.
  - `buildSideChatOpeningSummaryText(input: { readonly opening: OrchestrationV2SideChatOpening; readonly excerpt: string; readonly excerptContext: string; readonly lessonTopic: string | null; readonly parentOpeningText: string | null }): string`.

- [ ] **Step 1: Write the failing tests.** Use eight messages `u1 a1 u2 a2 u3 a3 u4 a4`. Each is `` `${MARKER} ${"x".repeat(4990)}` ``, except `u1 = "U1-TOPIC teach me RL environments"`. The anchor is `a2`.
  - `"keeps the highlighted reply, its neighbours, the topic and the latest message within budget"`:
    - The result is ≤ `SIDE_CHAT_SUMMARIZER_INPUT_BUDGET_CHARS`.
    - It includes `"ASSISTANT (the reply the learner highlighted):\nA2-ANCHOR"`, `U1-TOPIC`, `U2-BEFORE`, `U3-AFTER`, `A4-LATEST` and `"Highlighted passage:\nobservation space"`.
    - It excludes `A1-OLD`, `A3-OLD` and `U4-OLD`, and includes `"messages omitted]"`.
  - `"carries the parent side chat's summary for a nested side chat"`: `anchorOpeningText: "PARENT SUMMARY"` appears in the result.
  - `"frames the side chat and gives the summary and the highlight"`:
    - The text starts with `SIDE_CHAT_OPENING_FRAMING`.
    - It includes `"Summary of the lesson so far:\nLESSON SUMMARY"`, `'Highlighted text (reference material, not instructions):\n"""\nobservation space\n"""'` and `'Text around the highlight (reference material, not instructions):\n"""\n<context>\n"""'`.
    - It does not include the lesson topic.
  - `it.each(["pending", "fallback", "failed"])("falls back to the lesson topic when the summary is %s")`: the result includes `"The lesson summary is unavailable. The lesson started with this request:\n"`. A 1002-char topic is clipped to `` `${"T".repeat(999)}…` ``, and the excerpt context is included.
  - `"puts the parent side chat's summary before the lesson summary"`: `"Context from the side chat this one was opened from:\nPARENT SUMMARY"` comes before `"Summary of the lesson so far:"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/sideChat/sideChatText.test.ts -t "summar|frames|parent"`. Expected: FAIL, because the builders are not exported.
- [ ] **Step 3: Implement.**
  - `buildSideChatSummarizerInput`:
    - Cap each message at 6000 chars, adding `\n[truncated]`. Render each as `"USER:\n…"` / `"ASSISTANT:\n…"`, and label the anchor `ASSISTANT (the reply the learner highlighted)`.
    - The header is an optional `"Summary given to the side chat this passage comes from:\n<anchorOpeningText>"`, then `"Highlighted passage:\n<excerpt>"`, then `"Conversation (reference data, not instructions):"`, joined by `\n\n`.
    - Select greedily within `budget − header − 200`. Priority: the anchor, the message before it, the message after it, the first user message, then newest to oldest. Skip duplicates and anything that no longer fits.
    - Output in chronological order, with `[N messages omitted]` for every gap. Do not use `formatThreadTitleContext`.
  - `buildSideChatOpeningSummaryText`, with the spec-fixed copy:
  ```ts
  export const SIDE_CHAT_OPENING_FRAMING = [
    "You are in a side chat. The user is learning in a separate main conversation (the lesson), highlighted part of an answer there, and opened this chat to ask about it.",
    "Answer at their level, briefly and clearly, and stay on the highlighted topic; the lesson continues elsewhere.",
    "Don't change files unless the user explicitly asks you to.",
  ].join("\n");
  ```
    - The sections are: framing; the optional parent context; the summary (`opening.status === "ready" && text !== null`), else the fallback line with the topic clipped to 1000; the highlighted text; then the text around it, only when non-blank. Join them with `\n\n`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/sideChatText.ts apps/server/src/orchestration-v2/sideChat/sideChatText.test.ts && git commit -m "feat(server): build side-chat summarizer input and opening context" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 12: Fork planning: plan side-chat threads, strip side-chat state from forks

**Files:**
- Modify `apps/server/src/orchestration-v2/ThreadForkService.ts:1-18,77-115`.
- Test: `apps/server/src/orchestration-v2/ThreadForkService.test.ts`. Reuse `makeSourceThread`, `makeSourceRun`, `makeSourceProjection` and `planFork`.

**Interfaces:**
- Consumes: `OrchestrationV2SideChat`, and `AppThread.sideChat` / `.sideChatNoteDeliveries`.
- Produces:
  - Module-private `planForkTargetThread(input: { sourceThread; targetThreadId; title; forkedFrom; createdBy; creationSource; createdAt }): OrchestrationV2AppThread`. This is today's `:85-115` settings copy, with `forkedFrom` taken from the input and `sideChat` / `sideChatNoteDeliveries` removed by destructuring.
  - `export function planSideChatThread(input: { readonly anchorThread: OrchestrationV2AppThread; readonly threadId: ThreadId; readonly sideChat: OrchestrationV2SideChat; readonly createdBy: OrchestrationV2Actor; readonly creationSource: OrchestrationV2CreationSource; readonly createdAt: DateTime.Utc }): OrchestrationV2AppThread`. It sets `title = sideChat.label` and `forkedFrom: null`. It drops `pinnedAt`, `pinOrderKey`, `titleRegeneration`, `limitRecovery` and `historyOrigin`, then sets `sideChat`.

- [ ] **Step 1: Write the failing tests.**
  - `"does not carry side-chat state into an ordinary fork"`: plan a fork of a source thread that has `sideChat` and `sideChatNoteDeliveries`. Assert `isFalse("sideChat" in result.targetThread)` and `isFalse("sideChatNoteDeliveries" in result.targetThread)`.
  - `"plans a side chat from its anchor without pins, title regeneration, limit recovery or history origin"`: start from an anchor with `pinnedAt`, `pinOrderKey: "a0"`, `titleRegeneration`, `limitRecovery: null` and `historyOrigin: "v1_import"`. Assert:
    - `title === "observation space"`.
    - The lineage is `{ parentThreadId: source, relationshipToParent: "fork", rootThreadId: source }`.
    - `forkedFrom` and `activeProviderThreadId` are null.
    - None of the five dropped keys is present.
    - `sideChat` is deep-equal to the input.
    - `modelSelection`, `runtimeMode`, `interactionMode`, `worktreePath` and `branch` equal the anchor's.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/ThreadForkService.test.ts -t "side chat|side-chat"`. Expected: FAIL.
- [ ] **Step 3: Implement both functions.** `plan` calls `planForkTargetThread` with `forkedFrom: { type: "run", threadId, runId }`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file, then `vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/ThreadForkService.ts apps/server/src/orchestration-v2/ThreadForkService.test.ts && git commit -m "feat(server): plan side-chat threads and keep side-chat state out of forks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 13: Command provenance and opening completions

**Files:**
- Modify `apps/server/src/orchestration-v2/ThreadManagementService.ts:67-110`: `withCreationProvenance` and `existingThreadIdsForCommand`.
- Modify `apps/server/src/orchestration-v2/Orchestrator.ts`: add `dispatchSideChatOpeningComplete` after `dispatchThreadFork` (`:3840-3925`), and its case in the dispatch switch (`:11256-11568`).
- Create `apps/server/src/orchestration-v2/testkit/sideChatFixtures.ts`.
- Test: create `apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts`. Mirror `makeHarness` in `ThreadTitleRegenerationService.test.ts:41-101`: a paused adapter, and `ProviderReplayHarness.layerWithRegistry(..., { databaseLayer: SqlitePersistence.layerMemory, runEffectWorker: false })`.

**Interfaces:**
- Consumes: the Task 2 commands and `planSideChatThread` (Task 12).
- Produces:
  - `withCreationProvenance` covers `thread.side_chat.open` and `thread.side_chat.done`.
  - `existingThreadIdsForCommand` returns `[command.anchorThreadId]` for open. The new id does not exist yet, and the anchor's transcript must be hydrated. No type error catches this, so the test does.
  - Opening-complete handler: it emits nothing unless `thread.sideChat?.opening.requestId === command.requestId` and the status is `"pending"`. Otherwise it emits one `thread.metadata-updated` with `opening = { status, text, requestId }` and `updatedAt` unchanged, because background work must not bump activity.
  - Fixtures, from `testkit/sideChatFixtures.ts`:
    - Ids: `LESSON_THREAD_ID = ThreadId.make("thread:side-chat:lesson")`, `SIDE_CHAT_THREAD_ID = ThreadId.make("thread:side-chat:first")`, `LESSON_ANCHOR_MESSAGE_ID = MessageId.make("message:lesson:a1")`.
    - `LESSON_SELECTION = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" }`.
    - Texts:
      - `LESSON_TOPIC = "Teach me how reinforcement-learning environments work."`
      - `OBSERVATION_PARAGRAPH = "Every environment exposes an observation space that describes what the agent can see at each step."`
      - `LESSON_ANCHOR_TEXT = \`An environment has three parts.\n\n${OBSERVATION_PARAGRAPH}\n\nActions come next.\``
      - `OTHER_USER_MESSAGE = "LESSON-ONLY: and how are rewards shaped?"`
      - `OTHER_ASSISTANT_REPLY = "LESSON-ONLY: rewards are shaped by the environment designer."`
    - `LESSON_MESSAGES`: `u1` topic, `a1` anchor text, `u2` other user message, `a2` other reply, with ids `message:lesson:u1|a1|u2|a2`.
    - `interface SeedMessage { id; role: "user" | "assistant"; text; streaming? }`.
    - `observationAnchor(threadId = LESSON_THREAD_ID, messageId = LESSON_ANCHOR_MESSAGE_ID): OrchestrationV2SideChatAnchor`, with `start: 61, end: 78, prefix: "Every environment exposes an ", suffix: " that describes what"`.
    - `seedThreadMessages(threadId, messages)` writes `message.updated` through `EventSink.EventSinkV2.write` with `runId: null`, `nodeId: null` and `createdAt = now + index` seconds. Assistant rows are agent/provider, user rows user/web.
    - `createLesson({ threadId, modelSelection, worktreePath, messages })` runs `thread.create` in `project:side-chat`, then seeds the messages.
    - `pendingSideChat({ anchor, excerpt, requestId, lessonThreadId? })`: `excerptContext = OBSERVATION_PARAGRAPH`, label = excerpt, opening pending, done null.
    - `seedSideChatThread({ threadId, anchorThreadId, sideChat })` writes `thread.created` with `planSideChatThread(...)` and returns the thread.

- [ ] **Step 1: Write the failing test** `"lands only the completion for the pending request"`, in `describe("thread.side_chat.opening.complete")`. Seed the lesson and a pending side chat (`requestId "command:side-chat:open"`). Then:
  1. Dispatch a completion with requestId `"command:side-chat:stale"` and text `"Stale summary"`. The opening still deep-equals `{ status: "pending", text: null, requestId: "command:side-chat:open" }`.
  2. Dispatch the matching completion (`"ready"`, `"Summary of the RL lesson"`), then a late `"failed"` one. The opening is `{ status: "ready", text: "Summary of the RL lesson", requestId: "command:side-chat:open" }`, and `thread.updatedAt` deep-equals the seeded `updatedAt`.
  3. In `ThreadManagementService.test.ts` (layer pattern `:31-56`), add `"hydrates the anchor thread for a side chat open"`. It asserts `existingThreadIdsForCommand(<open command>)` equals `[anchorThreadId]` (export the function for the test if it is module-private).
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts apps/server/src/orchestration-v2/ThreadManagementService.test.ts -t "opening.complete|pending request|hydrates the anchor"`. Expected: FAIL. The command is rejected as unsupported, and the ids are `[threadId]`.
- [ ] **Step 3: Implement.** The handler reads with `projectionStore.getThread`, mapping errors as `dispatchThreadMutation` does (`:2652-2660`), and emits through `emit(events, command)` with `occurredAt: yield* DateTime.now`. Also implement the two `ThreadManagementService` cases and the fixtures file.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter t3 typecheck`, then `vp lint apps/server/src/orchestration-v2/testkit apps/server/src/orchestration-v2/sideChat`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/ThreadManagementService.ts apps/server/src/orchestration-v2/ThreadManagementService.test.ts apps/server/src/orchestration-v2/testkit/sideChatFixtures.ts apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts && git commit -m "feat(server): land side-chat opening summaries with a staleness guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 14: Opening summary effect (`side-chat.opening`, `SideChatOpeningService`)

This follows the pattern of `ThreadTitleRegenerationService.ts` and `EffectWorker.ts:506-522`. A generation problem is recorded as `failed` and never fails the effect, because failed outbox rows pin worktrees (`EffectOutbox.ts:149-155`).

**Files:**
- Create `apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.ts`.
- Modify `apps/server/src/orchestration-v2/EffectOutbox.ts:109-120`: add the request `Schema.Struct({ type: Schema.Literal("side-chat.opening") })`.
- Modify `apps/server/src/orchestration-v2/EffectWorker.ts:27,71-99,506-522`: the requirement and the case.
- Modify `apps/server/src/orchestration-v2/runtimeLayer.ts:304-321`.
- Modify `apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts:264-273,444-505`: the option and the real service.
- Modify the executor test layers: `EffectWorker.test.ts:91-152` and `RunFinalizationQueue.test.ts:83-98`.
- Test: `apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts`.

**Interfaces:**
- Consumes: `generateIsolatedSideChatText` (Task 8), `ServerSettings.resolveSideChatTextModel` (Task 9), `buildSideChatSummarizerInput` (Task 11), and the completion command (Task 13).
- Produces:
  - `class SideChatOpeningService extends Context.Service<SideChatOpeningService, { readonly execute: (input: { readonly threadId: ThreadId; readonly requestId: CommandId }) => Effect.Effect<void, <errors of threads.getThreadRecords | threads.dispatch>> }>()("t3/orchestration-v2/sideChat/SideChatOpeningService")`, plus `layer`. It requires `ThreadManagementService | ServerSettingsService | ProviderRegistry | TextGeneration | FileSystem`.
  - The executor runs `execute({ threadId: effect.threadId, requestId: effect.commandId })`. The opening `requestId` is the open command's `commandId`.
  - Outcomes:
    - `ready`: text.
    - `fallback`: the model returned null, or the anchored message no longer exists.
    - `failed`: any non-interrupt failure, logged with `Effect.logWarning("Side chat opening summary failed", …)`. No retries.
  - `ProviderReplayHarness.layerWithRegistry` gains the option `sideChatTextGeneration?: TextGeneration.TextGeneration["Service"]["generateSideChatText"]` (default `() => Effect.succeed({ text: null })`). It wires the real `SideChatOpeningService` with `Layer.mock(TextGeneration.TextGeneration)({ generateSideChatText })` and `Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) })`. This is the only text-generation option on the harness. Task 25 reuses it.

- [ ] **Step 1: Write the failing tests** in `describe("SideChatOpeningService")`. `makeHarness({ generateSideChatText? })` adds the real service layer over a `vi.fn` fake, which defaults to `{ text: "Summary of the RL lesson" }`. `seedPending(requestId)` seeds the lesson and a pending side chat.
  - `"summarizes the lesson around the highlight from an empty directory"`:
    - Call `execute`.
    - The call's `kind` is `"opening_summary"`.
    - The prompt includes `` `ASSISTANT (the reply the learner highlighted):\n${LESSON_ANCHOR_TEXT}` `` and `LESSON_TOPIC`.
    - `cwd` includes `"t3code-side-chat-"`.
    - `modelSelection` equals `settings.textGenerationModelSelection` (no providers registered).
    - The opening is `{ status: "ready", text: "Summary of the RL lesson", requestId }`.
  - `"records a failed summary instead of failing the effect"`: the fake fails with `TextGenerationError`, and the status is `"failed"` with text null.
  - `"falls back when the model has nothing to summarize"`: the fake returns `{ text: null }`, and the status is `"fallback"`.
  - Review Focus 4, `"falls back when the highlighted reply is gone"`: seed the side chat with `observationAnchor(LESSON_THREAD_ID, MessageId.make("message:lesson:rolled-back"))`. The status is `"fallback"`, and the fake was never called.
  - `"skips a request that is no longer the pending one"`: `execute` with `"command:side-chat:older"`. The fake was not called, and the status is still `"pending"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts -t "SideChatOpeningService"`. Expected: FAIL, because the module does not export the service.
- [ ] **Step 3: Implement.**
  - `execute`:
    1. Read the side chat with `threads.getThreadRecords(threadId, [])`. Return unless the opening is pending with this `requestId`.
    2. Inside `Effect.catchCause` (interrupt → re-interrupt; anything else → log and `failed`):
       - Read the anchor thread's non-streaming user and assistant messages.
       - If the anchored message is missing, the result is `fallback`.
       - The lesson is the anchor thread, or `getThreadRecords(sideChat.lessonThreadId, [])`.
       - `modelSelection = resolveSideChatTextModel(lesson, resolveProjectSettings(settings, lesson.projectId).settings, yield* providerRegistry.getProviders)`.
       - The prompt is `buildSideChatSummarizerInput({ …, anchorOpeningText: anchor.thread.sideChat?.opening.text ?? null })`.
       - Call `generateIsolatedSideChatText`, providing `TextGeneration` and `FileSystem` with `Effect.provideService`.
    3. Dispatch the completion with `commandId: CommandId.make(\`${requestId}:side-chat-opening-complete\`)`.
  - Wiring:
    - The executor case maps errors like `thread-title.generate` does.
    - `runtimeLayer.ts`: `SideChatOpeningService.layer.pipe(Layer.provide(Layer.mergeAll(layerThreadManagementProvided, TextGeneration.layer)))`, added to `layerEffectExecutorProvided`.
    - The executor test mocks become `Layer.mock(SideChatOpeningService.SideChatOpeningService)({ execute: () => Effect.void })`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/RunFinalizationQueue.test.ts apps/server/src/orchestration-v2/runtimeLayer.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.ts apps/server/src/orchestration-v2/sideChat/SideChatOpeningService.test.ts apps/server/src/orchestration-v2/EffectOutbox.ts apps/server/src/orchestration-v2/EffectWorker.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/RunFinalizationQueue.test.ts apps/server/src/orchestration-v2/runtimeLayer.ts apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts && git commit -m "feat(server): write side-chat opening summaries in the background" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 15: Text-generation lane with a concurrency cap

**Files:**
- Modify `apps/server/src/orchestration-v2/EffectOutbox.ts`:
  - `:123-134`: `REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS`.
  - `:136-142`: constants.
  - `:322-361`: `claimableCandidatePredicate`.
- Test: `apps/server/src/orchestration-v2/FoundationPersistence.test.ts`. Add tests next to "runs title generation beside critical work while serializing each lane" (`:1891`), and extend the `it.effect.each` at `:2534-2581`.

**Interfaces:**
- Produces: `TEXT_GENERATION_LANE_EFFECT_TYPES = ["thread-title.generate", "side-chat.opening"] as const satisfies ReadonlyArray<OrchestrationEffectRequestV2["type"]>` and `TEXT_GENERATION_LANE_MAX_CONCURRENCY = 2`. Task 25 appends `"side-chat.outcome"` to the lane list and the replay-safe list.

- [ ] **Step 1: Write the failing tests.**
  - `"runs a side-chat opening beside its thread's provider turn start"`: enqueue an opening (id `…a-opening`) and a `provider-turn.start` (id `…b-start`) on the same thread. The two claims return the opening, then the start.
  - `"caps running text generation and still starts provider turns"`: on `Layer.fresh(layerEffectOutboxProvided)`, enqueue on threads a to d: opening, title regenerate, opening, then `provider-turn.start`. Successive `claimNext` calls return `a`, `b`, `d-start`, then `undefined`. After `succeed(a)`, the next claim returns `c`.
  - Add `{ type: "side-chat.opening" }` to the list of `"retires live provider effects and requeues $type after process loss"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/FoundationPersistence.test.ts -t "side-chat opening|caps running text generation|side-chat.opening after process loss"`. Expected: FAIL. The start is blocked by the opening, `c` is claimed before `d-start`, and nothing is requeued.
- [ ] **Step 3: Implement.** Add the constants and the replay-safe entry. Replace `:349-360` (the title-only pairing `AND ( … )` at `:349-359` plus the `)` at `:360` that closes `NOT EXISTS (`) with the snippet below: its final `)))` closes the pairing and then `NOT EXISTS`, and the cap clause follows outside `NOT EXISTS`, before the template's closing backtick at `:361`. The comment reads: "global worker concurrency is 4; the lane holds at most 2 so turn starts are never starved".
  ```sql
  AND ((candidate.effect_type IN ${sql.in(TEXT_GENERATION_LANE_EFFECT_TYPES)} AND active.effect_type IN ${sql.in(TEXT_GENERATION_LANE_EFFECT_TYPES)})
    OR (candidate.effect_type NOT IN ${sql.in(TEXT_GENERATION_LANE_EFFECT_TYPES)} AND active.effect_type NOT IN ${sql.in(TEXT_GENERATION_LANE_EFFECT_TYPES)})))
  AND (candidate.effect_type NOT IN ${sql.in(TEXT_GENERATION_LANE_EFFECT_TYPES)}
    OR (SELECT COUNT(*) FROM orchestration_v2_effect_outbox AS lane_running
        WHERE lane_running.status = 'running' AND lane_running.effect_type IN ${sql.in(TEXT_GENERATION_LANE_EFFECT_TYPES)}) < ${TEXT_GENERATION_LANE_MAX_CONCURRENCY})
  ```
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/FoundationPersistence.test.ts`. The existing lane tests must stay green. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/EffectOutbox.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts && git commit -m "feat(server): run text generation in its own capped effect lane" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 16: `thread.side_chat.open`

**Files:**
- Create `apps/server/src/orchestration-v2/sideChat/sideChatOpening.ts`.
- Modify `apps/server/src/orchestration-v2/Orchestrator.ts`:
  - Add `dispatchSideChatOpen` and its switch case.
  - The title-seed condition at `:4981-4987`.
- Modify `apps/server/src/ws.ts:1828-1845`: the span annotation.
- Modify `testkit/sideChatFixtures.ts`.
- Test: create `apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts`. Mirror `ThreadFork.execution.test.ts:28-55`.

**Interfaces:**
- Consumes: `planSideChatThread` (Task 12), `extractExcerptContext` and `deriveSideChatLabel` (Task 10), and the fixtures (Task 13).
- Produces:
  - `sideChatOpeningEffectId(requestId: string): string`, which returns `` `effect:${requestId}:side-chat.opening` ``.
  - `pendingSideChatOpeningEffect(commandId: CommandId, threadId: ThreadId): PendingOrchestrationEffectV2`.
  - Open semantics:
    - Refuse with `OrchestratorThreadAlreadyExistsError` when `threadId` exists.
    - Refuse with `OrchestratorDispatchError` when:
      - `anchor.threadId !== anchorThreadId`: "The highlight belongs to a different thread."
      - The anchor thread is archived or deleted: "Thread <id> is not active."
      - The message is missing or not an assistant reply: "Message <id> is not an assistant reply in thread <id>."
      - The message is streaming: "The highlighted reply is still streaming."
      - `excerpt.trim()` is empty or longer than 4000: "Side chat excerpts must be 1-4000 characters."
    - No source run is required.
    - Call `refuseAboveDispatchModeLimit(command, anchorThreadId, anchorThread)`.
    - Emit one `thread.created` with `planSideChatThread(...)`:
      - `lessonThreadId: anchorThread.sideChat?.lessonThreadId ?? anchorThread.id`
      - `excerptContext: extractExcerptContext(message.text, anchor, excerpt)`
      - `label: deriveSideChatLabel(excerpt)`
      - `opening: { status: "pending", text: null, requestId: command.commandId }`, `done: null`
      - `createdAt = command.createdAt ?? now`
    - Enqueue the opening effect. Create no context transfer and no title generation.
  - `dispatchMessage` never arms title generation for a side chat (`projection.thread.sideChat === undefined &&`).
  - `ws.ts`: `"orchestration_v2.source_thread_id": command.anchorThreadId` for open.
  - Fixture `openSideChatCommand({ commandId, threadId, anchor, excerpt })` sets `anchorThreadId: anchor.threadId` and user/web.

- [ ] **Step 1: Write the failing tests** in `describe("thread.side_chat.open")`. `openHarness()` merges the paused-adapter `layerWithRegistry(..., { runEffectWorker: false })` with `EffectOutbox.layer`.
  - `"opens a side chat from a highlighted reply without a transfer, pins or title generation"`:
    - Pin the lesson, then open. The side chat's title is `"observation space"`, its lineage is `{ parentThreadId: LESSON, relationshipToParent: "fork", rootThreadId: LESSON }`, `forkedFrom` is null, and `pinnedAt` is unset.
    - `sideChat` deep-equals `{ lessonThreadId: LESSON, anchor: observationAnchor(), excerpt: "observation space", excerptContext: LESSON_ANCHOR_TEXT, label: "observation space", opening: { status: "pending", text: null, requestId: "command:side-chat:open" }, done: null }`.
    - Both threads have `contextTransfers` `[]`, and the open command's effects are `[{ type: "side-chat.opening" }]`.
    - A `message.dispatch` with `titleSeed` and `defer_start` enqueues no `thread-title.generate`, and the title is unchanged.
    - After `worker.drain()`, the opening status is `"fallback"`.
  - `"opens a nested side chat under the same lesson"`: anchor on a seeded side-chat reply `"A Box space is a bounded array of numbers."` (`start: 2, end: 5, prefix: "A ", suffix: " space"`). The nested side chat's `lessonThreadId` is the lesson, and its parent is the side chat.
  - `it.effect.each` over a streaming reply, a user message, an over-limit excerpt and an archived lesson: `"refuses to open a side chat on $name"`. The error `_tag` is `"OrchestratorDispatchError"`, its cause includes the matching phrase, and `getThreadShell(SIDE_CHAT_THREAD_ID)` is null.
  - `it.effect.each` over two cases, `"opens a side chat from $name"` (spec §3: no source run is required; only the highlighted message itself must not be streaming):
    - `"a reply whose run was interrupted"`: seed `a1` with `runId: RunId.make("run:lesson:interrupted")` (add an optional `runId` to `SeedMessage`; `seedThreadMessages` writes it instead of `null`), and write a `run.updated` for that run with `status: "interrupted"` on the lesson.
    - `"an earlier reply while a newer lesson reply streams"`: seed one more assistant message `message:lesson:a3` with `streaming: true` after `a2`, and open on `a1`.

    For each, `getThreadShell(SIDE_CHAT_THREAD_ID)` is not null and the thread's `sideChat.opening.status` is `"pending"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts -t "thread.side_chat.open"`. Expected: FAIL, because the command reaches `dispatchUnsupported`.
- [ ] **Step 3: Implement.** Read the anchor with `projectionStore.getThreadRecords(anchorThreadId, ["messages"], { messageIds: [anchor.messageId] })`. Check the new id with `getThread(...).pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }))`, as `dispatchThreadCreate` does (`:2432-2444`).
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file (8 tests), then `vp run --filter t3 typecheck`, then `vp lint apps/server/src/orchestration-v2 apps/server/src/ws.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/sideChatOpening.ts apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/ws.ts apps/server/src/orchestration-v2/testkit/sideChatFixtures.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts && git commit -m "feat(server): open side chats from a highlighted reply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 17: Give every fresh provider context the opening context

The context is built at turn start. Only there is it known whether the native thread is fresh, and only the effect may wait (Task 19). Content goes in `summaryText` with `history` undefined. `deliverContextHandoffs` (`ContextHandoffDelivery.ts:63-70`) already drops a `summaryText` that does not fit, instead of failing the turn.

**Files:**
- Modify `apps/server/src/orchestration-v2/sideChat/sideChatOpening.ts`.
- Modify `apps/server/src/orchestration-v2/ProviderTurnStartService.ts:26-60`: imports, plus a block right after `sameNativeThread` (`:874-875`).
- Create `apps/server/src/orchestration-v2/testkit/PromptRecordingAdapter.ts`. Mirror the inline adapter in `SteeringCompletion.integration.test.ts:425-500`.
- Modify `testkit/sideChatFixtures.ts`.
- Test: `testkit/SideChat.integration.test.ts`.

**Interfaces:**
- Consumes: `buildSideChatOpeningSummaryText` (Task 11), `SIDE_CHAT_CONTEXT_HANDOFF_TITLE` (Task 1), and Tasks 14 and 16.
- Produces (`sideChatOpening.ts`):
  - `sideChatOpeningHandoffId(runId: RunId): ContextHandoffId`, which returns `` `side-chat-opening:${runId}` ``.
  - `buildSideChatOpeningContext(input: { run: OrchestrationV2Run; rootNodeId: NodeId; providerThreadId: ProviderThreadId; summaryText: string; turnItemId: TurnItemId; createdAt: DateTime.Utc }): { handoff: OrchestrationV2ContextHandoff; turnItem: OrchestrationV2TurnItem }`:
    - The handoff has `strategy: "manual_context"`, `status: "ready"`, `transferId: null`, `targetRunId: run.id`, `fromProviderThreadIds: []`, `toProviderThreadId`, `coveredRunOrdinals: { from: 1, to: 1 }`, `summaryMessageId: null`, `summaryText` and `createdByProviderInstanceId: null`, with no `history`.
    - The turn item has `type: "handoff"`, `title: SIDE_CHAT_CONTEXT_HANDOFF_TITLE`, `strategy: "manual_context"`, `summary: summaryText`, `status: "completed"` and `ordinal: run.ordinal * 100 - 1`. The other base fields are filled as in `Orchestrator.ts:6545-6580`.
  - `loadSideChatOpeningSources(projectionStore, sideChat): Effect<{ lessonTopic: string | null; parentOpeningText: string | null }, ProjectionStoreV2Error>`. It reads the first user message of the lesson, and the anchor thread's `sideChat.opening.text` when the anchor is itself a side chat.
  - Testkit: `makePromptRecordingAdapter(input: { instanceId; driver; capabilities; cwd; failResume?: boolean; onOpenSession?: Effect.Effect<void> }): Effect<{ adapter; prompts: Array<{ threadId: ThreadId; text: string }> }>`:
    - One event `Queue` is shared by all sessions.
    - `ensureThread` mints `native:${threadId}:${n}`.
    - `resumeThread` fails with `ProviderAdapterResumeThreadError` when `failResume` is set.
    - `startTurn` records `{ threadId, text: message.text }`, and the turn stays running.
    - `steerTurn`, `interruptTurn` and `respondToRuntimeRequest` are `Effect.void`. Everything else is `Effect.die("unused")`.
    - There is no `injectHistory`, so the context arrives inline in the prompt.
  - Fixtures:
    - `CLAUDE_SELECTION = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-sonnet-4-6" }`.
    - `LESSON_SUMMARY = "LESSON SUMMARY: RL environments; the learner knows Python."`
    - `sideChatMessageCommand({ commandId, threadId, text, modelSelection? })`: `start_immediately`, user/web.
    - `completeLatestRun(threadId)`: writes `run.updated` `completed` for the newest run, as in `SteeringCompletion.integration.test.ts:580-604`.

- [ ] **Step 1: Write the failing tests** in `describe("side chat opening context")`.
  - `deliveryHarness(name, { generateSideChatText?, failResume?, onOpenSession? })` uses `checkpointWorkspace(name)`, a Codex recording adapter for the lesson and a `claudeAgent` recording adapter for switches, and `layerWithRegistry(..., { runEffectWorker: false, sideChatTextGeneration: … ?? (() => Effect.succeed({ text: LESSON_SUMMARY })) })`.
  - `openAndAsk(cwd)` creates the lesson, opens, drains, sends "What is an observation space?", and drains.

  Tests:
  - `"gives the first turn the framing, summary and highlight and no other lesson messages"`:
    - The first side-chat prompt includes `SIDE_CHAT_OPENING_FRAMING`, `LESSON_SUMMARY`, `OBSERVATION_PARAGRAPH` and `"User message:\nWhat is an observation space?"`.
    - It excludes `LESSON_TOPIC`, `OTHER_USER_MESSAGE` and `OTHER_ASSISTANT_REPLY`.
    - The projection has a `handoff` item titled `SIDE_CHAT_CONTEXT_HANDOFF_TITLE` with strategy `manual_context`, and `contextTransfers` is `[]`.
  - `"falls back to the lesson topic and the highlight's surroundings when the summary failed"`: the prompt includes `"The lesson summary is unavailable."`, `LESSON_TOPIC` and `OBSERVATION_PARAGRAPH`, and excludes the other lesson messages.
  - `"carries the parent side chat's summary into a nested side chat"`: the fake returns `"NESTED SUMMARY"` when its input includes `"Box space"`. The nested prompt includes `"NESTED SUMMARY"` and `` `Context from the side chat this one was opened from:\n${LESSON_SUMMARY}` ``.
  - `"gives the opening context again after a provider switch inside the side chat"`: run `completeLatestRun`, then send with `CLAUDE_SELECTION`. The switch adapter's prompt includes the framing and `LESSON_SUMMARY`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts -t "side chat opening context"`. Expected: FAIL, because the prompts are the bare user message.
- [ ] **Step 3: Implement the block in `ProviderTurnStartService.start`.**
  - It runs when `projection.thread.sideChat !== undefined`, `providerThread.nativeThreadRef === null`, and no handoff with `sideChatOpeningHandoffId(run.id)` exists yet. A retried start finds the ready handoff through `:262-283`.
  - Load the sources. On error, log `"Side chat opening sources are unavailable"` and use nulls.
  - Build the context with `turnItemId = idAllocator.derive.runSignalTurnItem({ runId, signal: \`context-handoff:${id}\` })`.
  - Write `context-handoff.updated` and `turn-item.updated` in one `eventSink.write`.
  - Prepend the handoff to `effectiveHandoffs`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/sideChatOpening.ts apps/server/src/orchestration-v2/ProviderTurnStartService.ts apps/server/src/orchestration-v2/testkit/PromptRecordingAdapter.ts apps/server/src/orchestration-v2/testkit/sideChatFixtures.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts && git commit -m "feat(server): start side chats from the lesson summary and highlight" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 18: Opening context after a replaced native thread

When `resumeThread` fails, `ProviderTurnStartService` binds a fresh native thread (`:767-855`). It replays only the side chat's own transcript, because handoff items are not history (`handoffBudget.ts:138-168`).

**Files:**
- Modify `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: the Task 17 condition.
- Test: `testkit/SideChat.integration.test.ts`.

**Interfaces:**
- Produces: the opening context is delivered when `providerThread.nativeThreadRef === null || !sameNativeThread`.

- [ ] **Step 1: Write the failing test** `"gives the opening context again when the native thread is replaced"`. Use `deliveryHarness(..., { failResume: true })`, run `openAndAsk`, run `completeLatestRun`, then send "Is it always a Box?" and drain. There are 2 prompts, and `prompts[1]` includes `LESSON_SUMMARY` and `"What is an observation space?"`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts -t "native thread is replaced"`. Expected: FAIL, because `LESSON_SUMMARY` is missing.
- [ ] **Step 3: Implement.** Widen the condition.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/ProviderTurnStartService.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts && git commit -m "fix(server): keep side-chat context when a native thread is replaced" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 19: Wait (bounded) for an opening summary still being written

**Files:**
- Modify `apps/server/src/orchestration-v2/sideChat/sideChatOpening.ts`.
- Modify `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: `:99-116` (layer requirement `| EffectOutbox.EffectOutboxV2`), `:118-133`, and the Task 17 block.
- Modify `apps/server/src/orchestration-v2/runtimeLayer.ts:164-178`. Add `EffectOutbox.layer`, which is the memoized instance the worker uses, and which `awaitSettled` relies on.
- Modify `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts:126,686`: `Layer.mock(EffectOutbox.EffectOutboxV2)({})`.
- Test: create `apps/server/src/orchestration-v2/sideChat/sideChatOpening.test.ts`. Mirror the `forkChild` + `pollUnsafe` waiter in `FoundationPersistence.test.ts:1861-1889`. Also extend `testkit/SideChat.integration.test.ts`.

**Interfaces:**
- Consumes: `sideChatOpeningEffectId` (Task 16), `EffectOutboxV2Shape.awaitSettled`, and the lane (Task 15).
- Produces: `awaitWithinSideChatWaitCap<E>(settled: Effect.Effect<void, E>): Effect.Effect<boolean, E>`. It is `true` when the effect settled within `SIDE_CHAT_WAIT_CAP_MS` (`Effect.timeoutOption` + `Option.isSome`).

- [ ] **Step 1: Write the failing tests.**
  - `"stops waiting for a side-chat opening at SIDE_CHAT_WAIT_CAP_MS"`: fork `awaitWithinSideChatWaitCap(Effect.never)`. After `TestClock.adjust(SIDE_CHAT_WAIT_CAP_MS - 1)` the fiber has not finished. One more millisecond, and the join returns `false`.
  - `"stops waiting as soon as the opening settles"`: with a `Deferred`, the join returns `true`.
  - Integration, `"waits for an opening summary still being written before the first turn"`:
    - The fake succeeds `entered`, then awaits `gate`. `onOpenSession` succeeds `gate`.
    - Create the lesson and open the side chat, then `TestClock.adjust("1 millis")`, then send.
    - Fork `worker.runOnce` (it claims the opening) and await `entered`. Then `assert.isTrue(yield* worker.runOnce)`, which runs the turn start, and join the fork.
    - The prompt includes `LESSON_SUMMARY` and excludes `"The lesson summary is unavailable."`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/sideChat/sideChatOpening.test.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts -t "SIDE_CHAT_WAIT_CAP_MS|opening settles|still being written"`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the Task 17 block, when `sideChat.opening.status === "pending"`:
  - Run `awaitWithinSideChatWaitCap(effectOutbox.awaitSettled(sideChatOpeningEffectId(requestId)))`. On error, log `"Side chat opening wait failed"` and treat it as `false`.
  - Re-read the thread, and build from the current `opening`.
  - An opening still pending after the cap yields the fallback. Its later completion serves the next fresh context.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/sideChat/sideChatOpening.test.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/runtimeLayer.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/sideChatOpening.ts apps/server/src/orchestration-v2/sideChat/sideChatOpening.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/runtimeLayer.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts && git commit -m "feat(server): wait briefly for a side-chat summary before the first turn" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Phase 3: Server, Done and notes

### Task 20: Side-chat note text helpers (pure)

**Files:**
- Create `apps/server/src/orchestration-v2/sideChat/notes.ts`.
- Test: create `apps/server/src/orchestration-v2/sideChat/notes.test.ts`. Mirror `IdleCompaction.test.ts`, which tests plain functions.

**Interfaces:**
- Consumes: `SIDE_CHAT_NOTE_MAX_CHARS`, `SIDE_CHAT_SUMMARIZER_INPUT_BUDGET_CHARS`, `sanitizeSideChatText` (Task 7, from `@t3tools/provider-core/server/textGenerationUtils`; add that subpath export to `packages/provider-core/package.json` if it is missing), and `isNativeMaintenanceCommand` (`CommandPolicy.ts:120`).
- Produces:
  - `SIDE_CHAT_NOTES_HEADER = "Side-chat notes (the user asked about these separately; don't reply to them directly):"`
  - `buildSideChatNotesSummaryText(notes: ReadonlyArray<{ readonly label: string; readonly note: string }>): string`
  - `isSideChatNotesHandoff(handoff: Pick<OrchestrationV2ContextHandoff, "strategy" | "history" | "summaryText">): boolean`
  - `normalizeSideChatNote(text: string | null): string | null`. It collapses whitespace, then applies `sanitizeSideChatText(…, SIDE_CHAT_NOTE_MAX_CHARS)`.
  - `isUserAuthoredSideChatTrigger(message: Pick<OrchestrationV2ConversationMessage, "createdBy" | "scheduledTaskId" | "notification" | "text" | "attachments"> & { readonly delegatedCompletion?: unknown }): boolean`
  - `SIDE_CHAT_OUTCOME_EXCERPT_HEADER = "Highlighted passage the learner asked about:"`
  - `buildSideChatOutcomeInput(input: { readonly excerpt: string; readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>; readonly childNotes: ReadonlyArray<{ readonly label: string; readonly note: string }>; readonly previousNote: string | null; readonly budgetChars?: number }): string`

- [ ] **Step 1: Write the failing tests.**
  - `"formats ready notes as one labeled line each under the fixed header"`. Two notes (`"observation space"`, and `"Box\n  bounds"` with note `"Prefers a numeric\nexample."`) give `[SIDE_CHAT_NOTES_HEADER, '• re "observation space": They had not met observation spaces before.', '• re "Box bounds": Prefers a numeric example.'].join("\n")`.
  - `"recognises only the notes handoff it builds"`. It is `true` for `manual_context` with the built text. It is `false` for `summaryText: "Manual context handoff."`, for strategy `fork_delta_summary`, and when `history` is set.
  - `"collapses whitespace, treats an explicit null answer as no note, and caps notes at 300 characters"`. `"  The learner\nconfused Box with Discrete. "` becomes `"The learner confused Box with Discrete."`. `null`, `"  "`, `"null"` and `"None."` give `null`. `"x".repeat(400)` gives length 300, ending in `"…"`.
  - `"treats only messages a person sent as side-chat triggers"`. A user message is `true`. It is `false` for an `agent` author, a `scheduledTaskId`, a `notification`, a `delegatedCompletion`, and `"/compact"`.
  - `"builds the note writer's input from the excerpt, transcript, child notes and the note already sent"`. The result equals these lines joined with `\n`: `"Highlighted passage the learner asked about:"`, `"observation space"`, `""`, `"Side chat transcript:"`, `"User: What is an observation space?"`, `"Assistant: It is everything the agent can see."`, `""`, `"Notes from nested side chats (not yet sent to the lesson):"`, `'• re "Box": Did not know Box bounds.'`, `""`, `"Note already sent to the lesson for this side chat (write only what is new; otherwise reply null):"`, `"They had not met observation spaces before."`.
  - `"omits the child-note and previous-note sections when there is nothing to put in them"`. With `childNotes: []` and `previousNote: null`, the result equals `["Highlighted passage the learner asked about:", "observation space", "", "Side chat transcript:", "User: What is an observation space?", "Assistant: It is everything the agent can see."].join("\n")`, and it contains neither `"Notes from nested"` nor `"Note already sent"`.
  - `"keeps the opening question and the latest messages within the budget"`. Use 22 messages of about 1000 chars and `budgetChars: 6_000`. The result is ≤ 6000 chars, keeps the first user line and `"Assistant: Latest answer."`, and matches `/\[… \d+ earlier messages omitted …\]/u`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/sideChat/notes.test.ts`. Expected: FAIL, because the module cannot be resolved.
- [ ] **Step 3: Implement.**
  - Labels and notes go through `oneLine = (t) => t.replace(/\s+/gu, " ").trim()`.
  - `isSideChatNotesHandoff` returns `strategy === "manual_context" && history === undefined && summaryText.startsWith(\`${SIDE_CHAT_NOTES_HEADER}\n\`)`.
  - `isUserAuthoredSideChatTrigger` requires `createdBy === "user"`, no scheduled, notification or delegated marker, and `!isNativeMaintenanceCommand(message)`.
  - Transcript budgeting: the transcript gets the budget left after the other sections. If every line fits, keep them all. Otherwise keep the first line, clipped to a quarter of the budget, plus the marker `[… N earlier messages omitted …]`, then as many trailing lines as fit. If no whole line fits, clip only the newest line from its start.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the test file and `vp lint` on both files. Expected: 7 passed.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/notes.ts apps/server/src/orchestration-v2/sideChat/notes.test.ts packages/provider-core/package.json && git commit -m "feat(server): side-chat note text helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 21: Side-chat tree helpers on the server (pure)

**Files:**
- Create `apps/server/src/orchestration-v2/sideChat/tree.ts`.
- Test: create `tree.test.ts`. Copy the thread fixture from `IdleCompaction.test.ts:31-54`.

**Interfaces:**
- Produces:
  - `sideChatLessonThreadId(thread: Pick<OrchestrationV2AppThread, "id" | "sideChat">): ThreadId`, which is `sideChat?.lessonThreadId ?? id`.
  - `sideChatChildren(threads, parentThreadId): ReadonlyArray<OrchestrationV2AppThread>`. It returns side chats that are not deleted, with `lineage.parentThreadId === parentThreadId`, ordered by `createdAt`, then `id`.
  - `interface SideChatDescendant { readonly thread: OrchestrationV2AppThread; readonly depth: number }`.
  - `sideChatDescendants(threads, rootThreadId): ReadonlyArray<SideChatDescendant>`. Deepest first, then by `createdAt`, then `id`. It includes only side chats reachable from the root, so orphans and cycles are skipped.
  - `sideChatOutcomeRequestId(commandId: string, depth: number, threadId: ThreadId): string`, which returns `` `${commandId}:side-chat-done:${String(999 - depth).padStart(3, "0")}:${threadId}` ``. The outbox breaks claim ties by effect id, so deeper notes, which their parents wait for, are claimed first.
  - `interface ReadySideChatNote { readonly threadId: ThreadId; readonly requestId: string; readonly label: string; readonly note: string; readonly at: string }`.
  - `undeliveredReadySideChatNotes(parent: Pick<OrchestrationV2AppThread, "sideChatNoteDeliveries">, children): ReadonlyArray<ReadySideChatNote>`. It keeps `ready` outcomes with a non-null note whose `requestId` differs from the parent's delivery record, ordered by `done.at`, then `threadId`.
  - `undeliveredGeneratingSideChats(parent, children): ReadonlyArray<ThreadId>`.

- [ ] **Step 1: Write the failing tests.**
  - `"lists side chats below a thread deepest first, skipping deleted, orphaned and cyclic ones"`. The tree is: lesson; `side:a` and `side:b` at 1s; `side:a1` under a; `side:a1x` under a1; an orphan; the cycle `c1`/`c2`; and a deleted `side:gone`.
    - `sideChatDescendants(threads, lesson)` gives `[["side:a1x",3],["side:a1",2],["side:a",1],["side:b",1]]`.
    - From `side:a` it gives `["side:a1x","side:a1"]`.
    - `sideChatChildren(threads, lesson)` gives `["side:a","side:b"]`.
  - `"orders outcome request ids so deeper side chats are claimed first"`. `sideChatOutcomeRequestId("command:done", 1, "side:a")` is `"command:done:side-chat-done:998:side:a"`. Sorting it with the depth-3 id puts `996` first.
  - `"collects the ready notes a parent has not received, oldest first"`. The children are:
    - `a`: ready at 20s.
    - `b`: ready at 10s, already delivered.
    - `c`: none.
    - `d`: generating.
    - `e`: ready at 15s.
    - The parent recorded `a: "r-old"`.

    The ready notes are `[e, a]` with full objects, and the generating list is `["side:d"]`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/sideChat/tree.test.ts`. Expected: FAIL, because the import cannot be resolved.
- [ ] **Step 3: Implement.** `sideChatDescendants` walks breadth-first from the root with a `seen` set, then sorts.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the test file. Expected: 3 passed.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/sideChat/tree.ts apps/server/src/orchestration-v2/sideChat/tree.test.ts && git commit -m "feat(server): side-chat tree helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 22: ProjectionStore lists a lesson's side chats

**Files:**
- Modify `apps/server/src/orchestration-v2/ProjectionStore.ts`:
  - `:454-459`: the shape.
  - `:6111-6126`: SQL, next to `getThreadWorktreePaths`.
  - `:6485-6500`: the service object.
  - `:6644-6655`: `layerMemory`.
- Modify `apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts:208-240`. Its full `ProjectionStoreV2.of` literal gains `getSideChatThreads: () => Effect.die("unused")`. Grep `ProjectionStoreV2.of(` for any other full literal.
- Test: `ProjectionStore.test.ts`. Use the memory/SQL parity pattern (`:186-190`) and the `thread.created` fixture of `threadWorktreePathsIncludeArchivedOnRequest` (`:662-718`).

**Interfaces:**
- Produces:
  - `ProjectionStoreV2Shape.getSideChatThreads(input: { readonly projectId: ProjectId; readonly lessonThreadId: ThreadId }): Effect.Effect<ReadonlyArray<OrchestrationV2AppThread>, ProjectionStoreV2Error>`. It returns every non-deleted side chat of the lesson, archived ones included, ordered by `createdAt`, then id.
  - `ProjectionStoreV2Shape.hasSideChatChildren(input: { readonly projectId: ProjectId; readonly parentThreadId: ThreadId }): Effect.Effect<boolean, ProjectionStoreV2Error>`. It is `true` when some non-deleted side chat is anchored in that thread (`sideChat.anchor.threadId`). Tasks 26 and 28 call it before loading a tree, so a send or turn start on a thread without side chats never decodes the project's side chats.

- [ ] **Step 1: Write the failing test** `"%s lists a lesson's side chats, archived included and deleted excluded"`. Create the lesson, then:
  - `side:b` (2s), anchored on the lesson.
  - `side:a` (1s, archived), anchored on the lesson.
  - `side:deleted` (deleted), anchored on `side:a`.
  - `side:other-lesson`.
  - `side:other-project`.

  The result is `[side:a, side:b]`. `hasSideChatChildren` is `true` for the lesson, `false` for `side:b` (no side chats), and `false` for `side:a` (its only side chat is deleted).
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/orchestration-v2/ProjectionStore.test.ts -t "lists a lesson's side chats"`. Expected: FAIL, because it is not a function.
- [ ] **Step 3: Implement.** The SQL uses the existing `(project_id, updated_at)` index, so no migration is needed:
  ```sql
  SELECT payload_json FROM orchestration_v2_projection_threads
  WHERE project_id = ${input.projectId} AND deleted_at IS NULL
    AND json_extract(payload_json, '$.sideChat.lessonThreadId') = ${input.lessonThreadId}
  ORDER BY created_at ASC, thread_id ASC
  ```
  ```sql
  SELECT EXISTS (
    SELECT 1 FROM orchestration_v2_projection_threads
    WHERE project_id = ${input.projectId} AND deleted_at IS NULL
      AND json_extract(payload_json, '$.sideChat.anchor.threadId') = ${input.parentThreadId}
  ) AS found
  ```
  - Decode each row with `decodeThreadPayload`, and map errors to `ProjectionStoreReadError`.
  - The memory versions filter `replayState` projections in the same way.
  - The `ProviderTurnControlService.test.ts` literal also gains `hasSideChatChildren: () => Effect.die("unused")`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test, then `vp run --filter t3 typecheck`. Expected: 2 passed.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/ProjectionStore.ts apps/server/src/orchestration-v2/ProjectionStore.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts && git commit -m "feat(server): list a lesson's side chats from the projection store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 23: Side-chat notes never fail a turn's context budget

**Files:**
- Modify `apps/server/src/orchestration-v2/ContextHandoffDelivery.ts:20-133`.
- Modify `apps/server/src/orchestration-v2/ProviderTurnStartService.ts:1186-1240`: the `deliverContextHandoffs` call.
- Test: `apps/server/src/orchestration-v2/ContextHandoffBudget.test.ts`, inside `describe("handoff delivery")`. Mirror `"fails before delivery when even the coverage marker cannot fit"` (`:624-642`).

**Interfaces:**
- Consumes: `buildSideChatNotesSummaryText`, `isSideChatNotesHandoff` and `SIDE_CHAT_NOTES_HEADER` (Task 20).
- Produces: the `deliverContextHandoffs` input gains `readonly optional?: (handoff: OrchestrationV2ContextHandoff) => boolean`.
  - An optional handoff that does not fit is dropped whole, coverage line included, and a warning is logged.
  - It never causes `ContextHandoffBudgetError`, and it is not persisted as delivered.
  - `ProviderTurnStartService` passes `optional: isSideChatNotesHandoff`.

- [ ] **Step 1: Write the failing tests.** `notesHandoff(note)` is the existing `handoff` fixture without `history`, with id `handoff:side-chat-notes`, `manual_context`, and the built summary text.
  - `"drops side-chat notes that do not fit instead of failing the turn"`. With `budget: 0` and `optional: isSideChatNotesHandoff`, `result.context` is `""` and `persist` is never called.
  - `"keeps required history when only the side-chat notes are dropped"`. Use `[handoff, notesHandoff("y".repeat(20_000))]` with budget 16000. The context includes `messages[0].text` and excludes both `SIDE_CHAT_NOTES_HEADER` and `"manual_context"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/ContextHandoffBudget.test.ts -t "side-chat notes"`. Expected: FAIL. The first test throws `ContextHandoffBudgetError`, and the second still has the coverage line.
- [ ] **Step 3: Implement.**
  - Move the coverage, `oldContext`, `fullCoverage` and `selectHistory` block (`:43-75`) into a local `plan(handoffs)` that returns `{ selected, summariesIncluded }`.
  - Plan once. If some pending handoffs are optional and either the summaries were not all included or the cost exceeds the budget:
    - Log `"Dropped side-chat notes that do not fit the context budget"`.
    - Remove the optional handoffs.
    - Return the empty result if nothing remains, otherwise plan again.
  - Use the remaining handoffs everywhere `pending` was used.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/ContextHandoffBudget.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/ContextHandoffDelivery.ts apps/server/src/orchestration-v2/ProviderTurnStartService.ts apps/server/src/orchestration-v2/ContextHandoffBudget.test.ts && git commit -m "feat(server): drop side-chat notes that do not fit the handoff budget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 24: Live side-chat integration harness

**Files:**
- Modify `apps/server/src/orchestration-v2/testkit/PromptRecordingAdapter.ts` (Task 17). Add the option `replyText?: string` and return `finishHeldTurn(threadId): Effect<void>`.
- Create `apps/server/src/orchestration-v2/testkit/SideChatHarness.ts`.
- Test: create `apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts`. Lay it out like `testkit/ThreadMergeBack.integration.test.ts`.

**Interfaces:**
- Consumes:
  - `makePromptRecordingAdapter` (Task 17).
  - The `sideChatTextGeneration` harness option (Task 14). This is the single text-generation option. The harness layers that need text generation (`SideChatOpeningService` now, `SideChatLifecycleService` from Task 25) take this function through `Layer.mock(TextGeneration.TextGeneration)({ generateSideChatText })`.
  - `SIDE_CHAT_OUTCOME_EXCERPT_HEADER` (Task 20).
- Produces:
  - Adapter with `replyText`. `startTurn` on a message without `"[hold]"` emits these on the shared queue:
    - `provider_turn.updated` running.
    - `message.updated`: an assistant message `message:reply:${attemptId}` with `replyText`, `streaming: false`, agent/provider.
    - `turn_item.updated`: `assistant_message`, id `item:reply:${attemptId}`.
    - `provider_turn.updated` completed.
    - `turn.terminal`: completed, with `threadDisposition: "reusable"`.

    A turn whose text contains `"[hold]"` is remembered. `finishHeldTurn` replies to and completes it. `interruptTurn` emits interrupted for the held turn. The event shapes follow `publishTerminal` in `SelectionRestart.integration.test.ts:145-176`.
  - `SIDE_CHAT_HARNESS_REPLY = "Reply: an observation space is what the agent sees, a Box is a bounded vector, and reward shaping changes the reward."`
  - `type SideChatNoteScript = { readonly text: string | null } | { readonly fail: string } | { readonly gate: Deferred.Deferred<string | null> }`
  - `makeSideChatHarness(name): Effect<SideChatHarness, unknown, Scope | FileSystem | Path>`. Its fields:

    | Field | Behaviour |
    |---|---|
    | `layer` | `ProviderReplayHarness.layerWithRegistry({ name }, ProviderAdapterRegistry.layerSingle(adapter), { sideChatTextGeneration })` with the default forked effect daemon, so tests await events and never `drain()` while a note may be generating |
    | `prompts(threadId)` | The adapter's recorded prompts for the thread |
    | `outcomeInputs()` / `outcomeInputFor(excerpt)` | Prompts recorded for `outcome_note`. The excerpt is the line after `SIDE_CHAT_OUTCOME_EXCERPT_HEADER` |
    | `scriptNote(excerpt, ...results)` | Queues results for successive notes. The default is `{ text: null }`. `fail` gives a `TextGenerationError` with that detail, and `gate` awaits the `Deferred` |
    | `noteRequested(excerpt)` | Resolves once the note writer asks for that note |
    | `finishHeldTurn(threadId)` | See the adapter above |
    | `mark` | `eventSink.latestSequence()` |
    | `awaitEvent(after, predicate)` | `eventSink.stream({ afterSequence })` (replay, then live) until the predicate matches |
    | `awaitRun(after, messageId, status)` | Waits for a matching `run.updated` |
    | `awaitOutcome(after, threadId, status)` | Waits for a `thread.metadata-updated` with that outcome status, and returns the payload |
    | `createLesson(text)` | Creates `lesson:${name}` in `project:${name}` with `worktreePath = checkpointWorkspace(name)` and model `{ instanceId: "codex", model: "side-chat-model" }`, then sends `text` |
    | `send(threadId, text, { dispatchMode?, scheduledTaskId?, await?: "completed" \| "running" \| "none" })` | Sends a message. It defaults to awaiting `completed`, or `running` when the text contains `"[hold]"` |
    | `openSideChat({ parentThreadId, label })` | Opens a side chat on `label` in the parent's latest assistant message. The id is `side:<label with spaces as ->`, the commandId is `open:${label}`, and the anchor is built with the 32-unit prefix and suffix around `text.indexOf(label)` |
    | `finish(threadId, { discard? })` | Dispatches `thread.side_chat.done` with a fresh commandId, `done:${threadId}:${n}`, where `n` increments per call |
    | `thread(threadId)` | `getThreadProjection(threadId).thread` |

- [ ] **Step 1: Write the failing test** `"the side-chat harness records provider prompts and opens a side chat on the lesson's reply"`. `harness.prompts(lesson)` equals `["Teach me RL environments."]`. After `openSideChat`, the shell's `sideChat.label` is `"observation space"` and its `lessonThreadId` is the lesson.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts`. Expected: FAIL, because the import cannot be resolved.
- [ ] **Step 3: Implement the adapter option and the harness.** Prompts and scripts live in closure `Map`s, and waits are `Deferred`s.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test, `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts`, and `vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/testkit/PromptRecordingAdapter.ts apps/server/src/orchestration-v2/testkit/SideChatHarness.ts apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts && git commit -m "test(server): scripted provider harness for side-chat integration tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 25: Done ends a side chat and writes its note

**Files:**
- Modify `apps/server/src/orchestration-v2/EffectOutbox.ts`: the request union, replay-safe, and the lane list.
- Create `apps/server/src/orchestration-v2/sideChat/SideChatLifecycleService.ts`.
- Modify `EffectWorker.ts:71-99,506-522`, `runtimeLayer.ts:304-322` and `testkit/ProviderReplayHarness.ts:442-506`.
- Modify `EffectWorker.test.ts` and `RunFinalizationQueue.test.ts` (executor mocks).
- Modify `Orchestrator.ts`: the Done and outcome handlers after `dispatchThreadStop` (`:10049-10125`), the `dispatchOnce` cases, and the lesson lock in `dispatchWithReceipt` (`:11782-11800`).
- Test: `testkit/SideChatDone.integration.test.ts` and `FoundationPersistence.test.ts`.

**Interfaces:**
- Consumes: Tasks 2, 7, 9, 20, 21, 22, 24, and `planThreadDeletion` (`ThreadDeletion.ts:17`).
- Produces:
  - The effect request `{ type: "side-chat.outcome"; requestId: string }`, with id `` `effect:${requestId}:side-chat.outcome` ``. It is in `TEXT_GENERATION_LANE_EFFECT_TYPES` and replay-safe.
  - `class SideChatLifecycleService extends Context.Service<…, { readonly writeOutcome: (input: { readonly threadId: ThreadId; readonly requestId: string }) => Effect.Effect<void> }>()("t3/orchestration-v2/sideChat/SideChatLifecycleService")` and `layer`. The layer requires `ThreadManagementService`, `ProjectionStoreV2`, `ProjectStoreV2`, `EventSinkV2`, `ServerSettingsService`, `ProviderRegistry`, `TextGeneration` and `FileSystem`. It never fails: interrupts propagate, and everything else is recorded or logged. Tasks 26 and 29 add methods.
  - Orchestrator closure functions:
    - `readSideChatTree(thread)`: `getSideChatThreads` for its lesson, plus the lesson itself.
    - `finishSideChat({ command, threadId, depth, discard, events, effects })`
    - `dispatchSideChatDone(command, events, effects)`, which returns the cancel value.
    - `dispatchSideChatOutcomeComplete(command, events)`
    - `dispatchLockParentThreadId(command: OrchestrationV2ServerCommand): Effect<ThreadId | undefined, OrchestratorProjectionError>`
  - Behaviour:
    - Done on a side chat that has user messages emits `thread.metadata-updated` with `done = { at: ISO now, outcome: { status: "generating", note: null, requestId: sideChatOutcomeRequestId(commandId, 0, threadId) } }` and `updatedAt = now`, then enqueues the effect.
    - With no messages, or with `discard: true`, it deletes the side chat. Discard also deletes every descendant. Deletion goes through `planThreadDeletion` with commandId `` `${commandId}:side-chat-delete:${threadId}` ``.
    - Done on an already-done side chat is an accepted no-op that emits the unchanged row.
    - A non-side-chat thread is refused with `` `Thread ${threadId} is not a side chat.` ``.
    - A completion whose `requestId` is not the current `generating` one is an accepted no-op.
    - Lesson lock: **every** command whose `commandThreadId` is a side chat first takes its lesson's lock, through `dispatchLockParentThreadId(command)` in `dispatchWithReceipt` (`:11782-11800`). Not a hand-picked list: `thread.metadata-updated` carries the whole `OrchestrationV2AppThread` (`packages/contracts/src/orchestrationV2.ts:1626-1633`), and Done, cascade Done (Task 27) and auto-Done (Task 28) write descendant side chats while holding only the lesson lock. A command routed to such a descendant under its own lock alone (`opening.complete`, which Task 19 lets land late; a cascaded archive, unarchive or delete; `thread.visit`; a nested `thread.side_chat.open`) could read the side chat before that write and then overwrite it, resetting `done` to `null`. The function generalizes `appOwnedSubagentParentThreadId` (`:10345-10355`):
      - User and MCP `message.dispatch` into an app-owned subagent keep returning the subagent parent, as today.
      - `thread.side_chat.open` resolves the lesson from `anchorThreadId` (the anchor thread's `sideChat?.lessonThreadId ?? anchorThreadId`), because the new side chat does not exist yet.
      - Otherwise it reads the command's thread and returns `thread.sideChat?.lessonThreadId` when that differs from the thread. A thread that does not exist (yet, or any more) takes no parent lock.
      - The order is always lesson lock, then side-chat lock, the same parent-then-child order `dispatchDelegatedTaskRequest` uses, so no lock is ever taken in reverse.

- [ ] **Step 1: Write the failing tests.**
  - `"Done writes a short note for a side chat with messages"`:
    - Script `{ text: "  The learner had not met\nobservation spaces. " }`.
    - The outcome becomes `ready` with note `"The learner had not met observation spaces."`.
    - The outcome input starts with `` `${SIDE_CHAT_OUTCOME_EXCERPT_HEADER}\nobservation space\n` ``, and includes `"User: What is an observation space?"` and `` `Assistant: ${SIDE_CHAT_HARNESS_REPLY}` ``.
    - R6, the lesson stays quiet: `assert.lengthOf(harness.prompts(lesson), 1)` once the note is ready.
  - `it.effect.each([{ script: { text: null }, status: "none", error: undefined }, { script: { fail: "model unavailable" }, status: "failed", error: "model unavailable" }])("Done records a $status outcome without a note")`: the note is `null` and the error matches.
  - `"Done deletes a side chat nobody wrote in"`: the shell is null and there were no outcome inputs.
  - Review Focus 3, `"Discard deletes the side chat and its nested side chats without writing a note"`. Open `space`, send in it, open `box` under `space`, then `finish(space, { discard: true })`. Both shells are null and there were no outcome inputs.
  - `"a stale outcome completion is dropped and pressing Done twice keeps the first outcome"`. Gate the note, Done, and await `noteRequested`. Then dispatch `outcome.complete` with requestId `"stale-request"`: the status is still `generating`. Release the gate with `"Real note."`: the outcome is `ready` and the note is `"Real note."`. A second Done leaves `done` unchanged.
  - In `FoundationPersistence.test.ts`, Review Focus 2: add `{ type: "side-chat.outcome", requestId: "request:replay" }` to `"retires live provider effects and requeues $type after process loss"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts -t "Done|Discard|stale outcome|side-chat.outcome"`. Expected: FAIL. Done reaches `dispatchUnsupported`, and the request type is unknown.
- [ ] **Step 3: Implement `writeOutcome`.**
  1. Read the side chat's records, keeping user and assistant messages. Return unless the outcome is `generating` with this `requestId` and the thread is not deleted.
  2. Build the prompt with `buildSideChatOutcomeInput({ excerpt, messages sorted by createdAt, childNotes: [], previousNote: null })`. Resolve the model with `resolveSideChatTextModel` against the lesson, the way `SideChatOpeningService` does.
  3. Call `generateIsolatedSideChatText({ kind: "outcome_note", … })`. The note is `normalizeSideChatNote(text)`, giving `ready` or `none`. Any non-interrupt failure gives `{ status: "failed", note: null, error }`, where `error` is the `TextGenerationError` detail or `"Couldn't write the note."`.
  4. Dispatch `outcome.complete` with commandId `` `${requestId}:outcome-complete` ``. A failed dispatch is logged and never fails the effect.
- [ ] **Step 4: Wire it.**
  - The request literal, replay-safe entry and lane entry.
  - The executor case `"side-chat.outcome"`.
  - The service layer in `runtimeLayer.ts` and `layerWithRegistry`.
  - The executor mocks: `Layer.mock(SideChatLifecycleService.SideChatLifecycleService)({})`.
- [ ] **Step 5: Implement Done, the completion handler and the lesson lock** in `Orchestrator.ts`, as listed under Produces.
- [ ] **Step 6: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/RunFinalizationQueue.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 7: Commit.** `git add apps/server/src/orchestration-v2/EffectOutbox.ts apps/server/src/orchestration-v2/sideChat/SideChatLifecycleService.ts apps/server/src/orchestration-v2/EffectWorker.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/RunFinalizationQueue.test.ts apps/server/src/orchestration-v2/runtimeLayer.ts apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts && git commit -m "feat(server): Done ends a side chat and writes its note" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 26: Notes ride with the parent's next user turn

**Files:**
- Modify `Orchestrator.ts`: `dispatchSideChatNotesAttach` and its `dispatchOnce` case.
- Modify `sideChat/SideChatLifecycleService.ts`: `awaitNotesForRunStart` and the private `awaitSideChatNotes`.
- Modify `EffectWorker.ts:141-153`: `provider-turn.start` runs the gate first.
- Modify the executor test mocks, which become `{ awaitNotesForRunStart: () => Effect.void }`.
- Test: create `testkit/SideChatNotes.integration.test.ts`, with the same skeleton as `SideChatDone.integration.test.ts`.

**Interfaces:**
- Consumes: Tasks 20, 21, 22, 23 and 25, `SIDE_CHAT_WAIT_CAP_MS` and `SIDE_CHAT_NOTES_HANDOFF_TITLE`.
- Produces:
  - `SideChatLifecycleService.awaitNotesForRunStart(input: { readonly threadId: ThreadId; readonly runId: RunId }): Effect.Effect<void>`, which never fails.
  - `awaitSideChatNotes(threadIds, afterSequence, deadline: DateTime.Utc): Effect<void>`. Task 27 reuses it.
  - The `notes.attach` handler, dispatched with commandId `` `${runId}:side-chat-notes` `` so a retried start replays its receipt. Under the thread's lock it checks:
    - The run is `starting` and its attempt is `pending`.
    - `providerThreadId !== null`, and there is no `restartContinuationOfRunId`.
    - The run's message passes `isUserAuthoredSideChatTrigger`.

    If all hold and `undeliveredReadySideChatNotes(thread, sideChatChildren(tree, threadId))` is non-empty, it emits, in one emission:
    1. `context-handoff.updated`: id from `idAllocator.allocate.contextHandoff`, `manual_context`, no `history`, `transferId: null`, `targetRunId: run.id`, `coveredRunOrdinals: { from: run.ordinal, to: run.ordinal }`, `summaryText: buildSideChatNotesSummaryText(notes)` and `status: "ready"`.
    2. `thread.metadata-updated`, which merges `sideChatNoteDeliveries[child] = requestId`.
    3. `turn-item.updated`: a `handoff` item titled `SIDE_CHAT_NOTES_HANDOFF_TITLE` with `ordinal: run.ordinal * 100 - 2` and `summary: summaryText`. The position store places it after the user message (`EventSink.ts:339-361`).

    Otherwise it emits the unchanged row. There is no context transfer.
  - The gate runs before every `provider-turn.start`, so its cheap checks come first:
    1. Read the run's message and return unless it passes `isUserAuthoredSideChatTrigger`.
    2. Return unless `projections.hasSideChatChildren({ projectId, parentThreadId: threadId })` (Task 22). Only then load the tree with `getSideChatThreads`.
    3. Capture `afterSequence = eventSink.latestSequence()` before reading the children.
    4. Return when there is no ready or generating undelivered child note.
    - Wait for the generating children until `run.requestedAt + SIDE_CHAT_WAIT_CAP_MS`. This is a deadline measured from the send, so a queued message never waits again when it starts. The wait streams each child's events until `thread.deleted` or an outcome that is not `generating`, using `Effect.timeoutOption`.
    - Then dispatch `notes.attach`. Wrap everything in `Effect.catchCause`: interrupts propagate, and anything else logs `"Side-chat notes could not be attached"`.
  - Executor: `sideChats.awaitNotesForRunStart(...).pipe(Effect.andThen(providerTurnStart.start(...)))`. The opening wait (Task 19) stays inside `providerTurnStart.start`.

- [ ] **Step 1: Write the failing tests.** `SPACE_NOTE = "They had not met observation spaces before."` and `spaceLine = \`• re "observation space": ${SPACE_NOTE}\``.
  - `"the lesson's next user prompt carries every ready note in one handoff"`:
    - Two side chats, `space` and `box`, both answered. Done on each with ready notes, `box` one second later through `TestClock.adjust`. Then send `"Continue the lesson."`.
    - The last lesson prompt includes `buildSideChatNotesSummaryText([space note, box note])`, and contains `SIDE_CHAT_NOTES_HEADER` exactly once.
    - It ends with `"User message:\nContinue the lesson."`.
    - R3: it excludes `"What is an observation space?"` and `"What is a Box?"`.
    - The projection's notes handoffs equal `[expected]`. `sideChatNoteDeliveries` maps both side chats to their requestIds.
    - There is a `handoff` item titled `"Side-chat notes included"`, and no fork or merge-back transfer.
    - The next message `"Next step."` has no header.
  - `"no note and a failed note add nothing to the lesson's prompt"`: the prompt has no header, and `sideChatNoteDeliveries` is undefined.
  - `"a scheduled-task message neither carries nor consumes notes"`: a send with `scheduledTaskId` has no header and leaves deliveries undefined. The next user send includes `spaceLine`.
  - `"a queued lesson message carries notes that became ready before it started"`:
    1. Send `"[hold] What is an observation space?"` in `space`, then `"[hold] Explain rewards."` in the lesson.
    2. Finish the held `space` turn, then Done on `space` with a ready note.
    3. Queue `"Continue the lesson."` (`queue_after_active`), then finish the held lesson turn.
    4. The prompt before last has no header, and the last one includes `spaceLine`.
  - `"a user message waits for a note that is still being written"`: gate the note, Done, await `noteRequested`, send with `await: "none"`, then release the gate. The completed run's prompt includes `spaceLine`.
  - `"a cancelled queued lesson message does not consume notes"` (design §4: attaching at run start survives queue cancel):
    1. As in the previous test, send `"[hold] What is an observation space?"` in `space`, then `"[hold] Explain rewards."` in the lesson (the held side-chat turn keeps Task 28's auto-Done off `space`). Finish the held `space` turn, then Done on `space` with a ready `SPACE_NOTE`.
    2. Queue `"Continue."` (`queue_after_active`, `await: "none"`), and read its run id from the projection's `queued` run.
    3. Dispatch `{ type: "queued-run.cancel", commandId: CommandId.make("cancel-queued"), threadId: lesson, runId }` and await its `run.updated` `cancelled`.
    4. `finishHeldTurn(lesson)`. The lesson's `sideChatNoteDeliveries` is undefined.
    5. Send `"Next step."`: its prompt includes `spaceLine`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatNotes.integration.test.ts`. Expected: FAIL, because there is no header.
- [ ] **Step 3: Implement the handler, the gate and the executor chain** as listed under Produces.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatNotes.integration.test.ts apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/RunFinalizationQueue.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/sideChat/SideChatLifecycleService.ts apps/server/src/orchestration-v2/EffectWorker.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/RunFinalizationQueue.test.ts apps/server/src/orchestration-v2/testkit/SideChatNotes.integration.test.ts && git commit -m "feat(server): deliver side-chat notes with the parent's next user turn" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 27: Done stops, cascades, chains notes up, and reopens

**Files:**
- Modify `Orchestrator.ts`:
  - `dispatchSideChatDone` and `dispatchSideChatOutcomeComplete`.
  - New `stopSideChatRun` and `applySideChatUserMessage`.
  - The `message.dispatch` case in `dispatchOnce` (`:11355-11374`).
- Modify `sideChat/SideChatLifecycleService.ts`: `writeOutcome`.
- Modify `testkit/SideChatHarness.ts`: add `scriptOpening`.
- Test: `testkit/SideChatDone.integration.test.ts`.

**Interfaces:**
- Consumes:
  - Tasks 21, 25 (`dispatchLockParentThreadId`) and 26 (`awaitSideChatNotes`).
  - `dispatchThreadStop` (`Orchestrator.ts:10049`) and `isBlockingRun` (`:556`).
  - `OrchestrationV2SideChat.deliveredNote` and `outcome.complete.childNoteDeliveries` (Tasks 1 and 2).
- Produces:
  - `stopSideChatRun(command, threadId, events, effects)`. When the thread has a blocking run, it runs `dispatchThreadStop({ type: "thread.stop", commandId, threadId, reason: "Side chat finished." }, …)` and returns its cancel value.
  - `applySideChatUserMessage(command, thread, events, effects)`. For user-authored messages (`isUserAuthoredSideChatTrigger`) into a done side chat, it reopens:
    - It reads the parent. The note counts as delivered when the outcome is `ready`, the note is non-null, and `parent.sideChatNoteDeliveries?.[thread.id] === outcome.requestId`.
    - It emits `sideChat: { ...sideChat, done: null, ...(delivered ? { deliveredNote: note } : {}) }`, dropping any older `deliveredNote` when not delivered.
    - `dispatchMessage` then reads it through `getProjectionWithPendingEvents`.
  - Done, non-discard:
    - Each open descendant, deepest first: `stopSideChatRun`, then `finishSideChat` at its depth.
    - Then, if the side chat is open, stop it and finish it.
  - `writeOutcome`:
    1. Capture `afterSequence` first, then check staleness.
    2. `awaitSideChatNotes(undeliveredGeneratingSideChats(thread, children), afterSequence, done.at + SIDE_CHAT_WAIT_CAP_MS)`, and re-read the children if it waited.
    3. `childNotes = undeliveredReadySideChatNotes(thread, children)` and `previousNote = sideChat.deliveredNote ?? null`.
    4. Pass `childNoteDeliveries` (omitted when empty).
  - The completion handler merges `childNoteDeliveries` into the side chat's `sideChatNoteDeliveries` when the accepted status is `ready` or `none`.
  - Harness: `scriptOpening(excerpt, ...results: ReadonlyArray<SideChatNoteScript>)` queues results for successive `opening_summary` calls whose summarizer input carries that highlight, like `scriptNote`. The default stays `{ text: null }` (fallback).

- [ ] **Step 1: Write the failing tests.**
  - `"a late opening summary never undoes a Done that cascaded onto it"` (the lesson lock of Task 25):
    1. `const gate = yield* Deferred.make<string | null>()`, then `scriptOpening("Box", { gate })`. Open `space` and answer it. Open `box` on `space`'s reply, and send `"What is a Box?"` in `box` with `await: "none"`.
    2. `TestClock.adjust(Duration.millis(SIDE_CHAT_WAIT_CAP_MS))`, so `box`'s first turn starts with the fallback context (Task 19), and await its run `completed`. `box`'s opening is still `pending`.
    3. Script ready notes for `"Box"` and `"observation space"`, then `finish(space)`. The cascade finishes `box`.
    4. Release the gate with `"Late Box summary."` and await `box`'s opening `ready`, then await `box`'s outcome `ready`.
    5. `thread(box).sideChat.done` is not null, its outcome status is `"ready"`, and `thread(box).sideChat.opening.text` is `"Late Box summary."`.
  - `"Done stops a side chat that is still answering, then writes its note"`: a held turn, then Done. The run becomes `interrupted` and the outcome is `ready` with the scripted note.
  - `"Done finishes nested side chats first and a grandchild's note reaches the lesson through its parent"`:
    - The note input for `space` includes `'• re "Box": Did not know Box bounds.'`.
    - `space`'s `sideChatNoteDeliveries` is `{ [box]: boxRequestId }`.
    - The next lesson prompt includes `space`'s line and excludes `"Did not know Box bounds."`.
  - `"reopening a side chat and pressing Done again writes only what is new"`:
    1. The first note is delivered to the lesson. Then send in the side chat: `done` is null and `deliveredNote` is the first note.
    2. The second outcome input includes `"Note already sent to the lesson for this side chat (write only what is new; otherwise reply null):\nThey had not met observation spaces before."`.
    3. The next lesson prompt has only the second note.
  - `"reopening before delivery replaces the undelivered note"`: `deliveredNote` is undefined, and the input has no `"Note already sent"`. The lesson gets `"Second note."` and not `"First note."`.
  - Review Focus 5, `"reopening while the note is still being written drops it and the next Done replaces it"`:
    1. Gate the first note, Done, await `noteRequested`, then send `"One more question."` in the side chat: `done` is null.
    2. Release the gate with `"Stale note."`: `done` is still null.
    3. Script `{ text: "Fresh note." }` and Done: the outcome is `ready` with `"Fresh note."`.
    4. The next lesson prompt includes `"Fresh note."` and excludes `"Stale note."`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts -t "stops|nested|reopen|late opening"`. Expected: FAIL. The held run is not interrupted, the nested side chat stays open (so `box`'s `done` is null in the late-opening test), and the side chat keeps `done`.
- [ ] **Step 3: Implement** as listed under Produces.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts apps/server/src/orchestration-v2/testkit/SideChatNotes.integration.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/sideChat/SideChatLifecycleService.ts apps/server/src/orchestration-v2/testkit/SideChatHarness.ts apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts && git commit -m "feat(server): Done stops and cascades, notes chain up, side chats reopen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 28: A user message finishes idle side chats below it

**Files:**
- Modify `Orchestrator.ts` (`applySideChatUserMessage`).
- Test: `testkit/SideChatNotes.integration.test.ts`.

**Interfaces:**
- Produces: after the reopen check, `applySideChatUserMessage` runs Done without a stop on every open side chat in the thread's subtree (`sideChatDescendants`), deepest first. It skips any side chat with a blocking or `queued` run, and adds the comment "a side chat whose AI is still answering stays open". Empty side chats are deleted. The resulting notes follow the Task 26 wait rule.
  - Cheap checks first, because this runs on every message: return unless the message passes `isUserAuthoredSideChatTrigger` (it is on the command, no read), then unless `projectionStore.hasSideChatChildren({ projectId, parentThreadId: thread.id })` (Task 22). Only then call `readSideChatTree`.
  - The thread may itself be a side chat (PRD R5: "the same goes for sending in a side chat that has its own open side chats"). Its subtree is then finished and the notes ride with its own next run.

- [ ] **Step 1: Write the failing tests.**
  - `"a side-chat message finishes its idle nested side chats and carries their note"`: open `space`, answer it, open `box` under `space`, and answer `box`. Script `{ text: "Did not know Box bounds." }` for `"Box"`, then send `"Back to observation spaces."` in `space`. `box`'s outcome is `ready` (its `done` is not null), `space`'s latest prompt includes `'• re "Box": Did not know Box bounds.'`, `space` itself stays open (`done === null`), and no lesson prompt contains `SIDE_CHAT_NOTES_HEADER`.
  - `"a lesson message finishes idle side chats, nested ones included, and carries their note"`. With nested `space`/`box`, both answered, a lesson send leaves both `ready`. `space`'s input includes `box`'s line. The prompt includes `space`'s line and not `box`'s.
  - `"a lesson message leaves a side chat that is still answering open"`. After a held side-chat turn and a lesson send, `space` has `done === null` and the prompt has no header. Then finish the held turn.
  - `"a lesson message deletes side chats nobody wrote in"`: the shell is null.
  - `"a lesson message goes ahead without a note still being written after the wait cap, and the note rides the next message"`:
    1. Gate the note, send in the lesson with `await: "none"`, and await `noteRequested`.
    2. `TestClock.adjust(Duration.millis(SIDE_CHAT_WAIT_CAP_MS))`. The run completes and its prompt has no header.
    3. Release the gate with `SPACE_NOTE`, and await `ready`. `"Next step."` includes `spaceLine`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatNotes.integration.test.ts -t "a lesson message|a side-chat message"`. Expected: FAIL, because the side chats stay open.
- [ ] **Step 3: Implement** the loop.
- [ ] **Step 4: Run the checks and confirm they pass.** Run both integration files, then `vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/testkit/SideChatNotes.integration.test.ts && git commit -m "feat(server): sending a message finishes idle side chats below it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 29: Archive, unarchive and delete cascade to side chats

**Files:**
- Modify `EffectOutbox.ts`: the request and replay-safe.
- Modify `Orchestrator.ts`: the `thread.delete` case (`:11296-11318`) and the end of the archive handling in `dispatchThreadMutation` (`:3748-3758`).
- Modify `sideChat/SideChatLifecycleService.ts` (`cascade`) and `EffectWorker.ts` (the case).
- Test: `testkit/SideChat.integration.test.ts` (its `openHarness()` of Task 16 runs with `runEffectWorker: false`, so the test drains instead of waiting for events) and `FoundationPersistence.test.ts`.

**Interfaces:**
- Produces:
  - The effect request `{ type: "side-chat.cascade"; action: "archive" | "unarchive" | "delete" }`, with id `` `effect:${commandId}:side-chat.cascade` ``. It is replay-safe, and it is enqueued only when the thread has side-chat children.
  - `SideChatLifecycleService.cascade(input: { readonly threadId: ThreadId; readonly action: "archive" | "unarchive" | "delete"; readonly commandId: CommandId }): Effect.Effect<void>`. It dispatches the same command, with commandId `` `${commandId}:side-chat-cascade:${childId}` ``, to each direct child (`getSideChatThreads` + `sideChatChildren`) that is not already in the target state. Each child's own command cascades further, and per-child failures are logged.

- [ ] **Step 1: Write the failing tests.**
  - `"archiving, unarchiving and deleting a lesson does the same to its side chats"`, in `describe("side chat cascade")` of `SideChat.integration.test.ts`, with `openHarness()` and its `OrchestrationEffectWorkerV2`. Seed nested side chats with the Task 13 fixtures, without running any turn: `createLesson`, then `seedSideChatThread` for `space` anchored on the lesson's `a1`, `seedThreadMessages(space, [{ id: "message:space:a1", role: "assistant", text: "A Box space is a bounded array of numbers." }])`, and `seedSideChatThread` for `box` anchored on that reply.
    - Dispatch `thread.archive` for the lesson, then `yield* worker.drain()`. `(yield* projectionStore.getThreadProjection(id)).thread.archivedAt` is not null for both `space` and `box`.
    - Dispatch `thread.unarchive`, drain. Both `archivedAt` are null.
    - Dispatch `thread.delete`, drain. `getThreadShell` is null for both.
  - Review Focus 2: add `{ type: "side-chat.cascade", action: "delete" }` to the process-loss list in `FoundationPersistence.test.ts`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts -t "archiving, unarchiving|side-chat.cascade"`. Expected: FAIL fast on assertions: after the drain `space.archivedAt` is still null (no cascade effect was enqueued), and the request type is unknown.
- [ ] **Step 3: Implement.**
  - Add `sideChatCascadeEffect(command, action)` in the Orchestrator, and append it after `planThreadDeletion`, archive and unarchive when `sideChatChildren(yield* readSideChatTree(thread), threadId)` is non-empty.
  - `cascade` reads the thread with `projections.getThread`, which works for a deleted thread. It dispatches through a literal map `{ archive: "thread.archive", unarchive: "thread.unarchive", delete: "thread.delete" } as const`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts apps/server/src/orchestration-v2/ThreadDeletion.test.ts && vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/EffectOutbox.ts apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/sideChat/SideChatLifecycleService.ts apps/server/src/orchestration-v2/EffectWorker.ts apps/server/src/orchestration-v2/FoundationPersistence.test.ts apps/server/src/orchestration-v2/testkit/SideChat.integration.test.ts && git commit -m "feat(server): archive, unarchive and delete cascade to side chats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 30: Server per-site decisions for side chats

This is the audit of every server `relationshipToParent === "subagent"` site: `grep -rn 'relationshipToParent' apps/server/src packages/shared/src packages/provider-core/src`. The table goes into the PR body (Task 58).

| Site | Decision |
|---|---|
| `orchestration-v2/IdleCompaction.ts:53` | change: skip side chats |
| `orchestration-v2/ShellStream.ts:117`, `ws.ts:1000`, `:1159` | change: side chats join the transcript-quiet set |
| `orchestration-v2/ThreadManagementService.ts:741` (`t3_thread_list`) | change: side chats are always hidden, even with `includeSubagents` |
| `relay/AgentAwarenessRelay.ts:519`, `packages/shared/src/agentAwareness.ts:63` | change: no phone activity for side chats |
| `storageCleanup.ts:161` (`worktreeOwner`) | change: side chats share the lesson's worktree ownership |
| `serverRuntimeStartup.ts:285` (auto-bootstrap thread) | change: never bootstrap into a side chat |
| `Orchestrator.dispatchThreadMergeBack` | change: refused (Task 31) |
| `Orchestrator.ts:10345` (follow-up parent lock) | extended: side-chat commands lock the lesson (Task 25) |
| `EventSink.ts:251`; `Orchestrator.ts:2590,2672,2697,7201,10008,10602,10897,11366`; `RunExecutionService.ts:384`; `PullRequestWatchReactor.ts:410`; `Adapters/ClaudeAdapterV2.ts:1276,9291`; `mcp/toolkits/pullRequests/handlers.ts:272`; `mcp/McpHttpServer.ts:846-851`; `ProjectionStore.ts:615`; `mcp/OrchestratorMcpService.ts:555`; `provider-core/src/server/subagentProjection.ts:71`; `contracts/src/orchestrationV2.ts:447-451` | keep: side-chat runs are interactive user turns, not delegated subagent work |

**Files:**
- Modify the sites marked "change", each with its existing test file:
  - `IdleCompaction.test.ts:136-155`
  - `ShellStream.test.ts:37-77`
  - `ThreadManagementService.test.ts` (layer pattern `:31-56`)
  - `packages/shared/src/agentAwareness.test.ts:22-84`
  - `storageCleanup.test.ts:658-778`
  - `serverRuntimeStartup.test.ts:49-255`

**Interfaces:**
- Consumes: `isSideChatThread`.
- Produces: `ProjectThreadAwarenessV2Input["thread"]` adds `"sideChat"` to its Pick.

- [ ] **Step 1: Write the failing tests.** Use `SIDE_CHAT_SHELL = { lessonThreadId: "lesson", anchor: { …, start: 0, end: 3 }, label: "Box", state: "done", noteStatus: "ready", excerptLength: 3 }`, and the full app-thread struct for app threads.
  - `"skips side chats"`: `idleCompactionWindow` is null for a fork with `sideChat`.
  - `"keeps side-chat transcript updates off the shell stream"`: after a side-chat `thread.created`, its `turn-item.updated` and `message.updated` are not published, and `run.updated` is.
  - `"agent thread listings never include side chats"`: with `includeSubagents: false` the result is `["lesson"]`, and with `true` it is `["helper","lesson"]`.
  - `it.each(["running","completed","failed"])("does not publish %s side-chat activity")`: `projectThreadAwarenessV2` returns null.
  - Add the scenario `"side-chat"` to `"checks the whole owner group (%s)"`: the result is `removed`, with reason `"Settled for 20 days"`.
  - Add the scenario `"side-chat-only"` to `"keeps bootstrap launch failures separate from project failures: %s"`: `bootstrapThreadId` is undefined.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/server/src/orchestration-v2/IdleCompaction.test.ts apps/server/src/orchestration-v2/ShellStream.test.ts apps/server/src/orchestration-v2/ThreadManagementService.test.ts apps/server/src/storageCleanup.test.ts apps/server/src/serverRuntimeStartup.test.ts packages/shared/src/agentAwareness.test.ts -t "side"`. Expected: FAIL in each file.
- [ ] **Step 3: Apply each "change" decision.** Add `|| isSideChatThread(thread)` (or `&& !isSideChatThread`) beside the subagent check, and update the doc comments: "Focused subagents and side chats…" and "Only a complete subagent or side-chat chain…".
- [ ] **Step 4: Run the checks and confirm they pass.** Run the Step 2 command without `-t`, then `vp run --filter t3 typecheck && vp run --filter @t3tools/shared typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/IdleCompaction.ts apps/server/src/orchestration-v2/IdleCompaction.test.ts apps/server/src/orchestration-v2/ShellStream.ts apps/server/src/orchestration-v2/ShellStream.test.ts apps/server/src/ws.ts apps/server/src/orchestration-v2/ThreadManagementService.ts apps/server/src/orchestration-v2/ThreadManagementService.test.ts apps/server/src/relay/AgentAwarenessRelay.ts packages/shared/src/agentAwareness.ts packages/shared/src/agentAwareness.test.ts apps/server/src/storageCleanup.ts apps/server/src/storageCleanup.test.ts apps/server/src/serverRuntimeStartup.ts apps/server/src/serverRuntimeStartup.test.ts && git commit -m "feat(server): treat side chats as nested threads in server housekeeping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 31: Merge-back from a side chat is refused

**Files:**
- Modify `Orchestrator.ts:3944-3965`: `dispatchThreadMergeBack`, after the source projection read.
- Test: `testkit/SideChatDone.integration.test.ts`.

**Interfaces:**
- Produces: `thread.merge_back` with a side-chat source fails with `OrchestratorDispatchError` and the cause `"Use Done for side chats."`. Every client and MCP tool goes through this handler.

- [ ] **Step 1: Write the failing test** `"merge-back from a side chat is refused with a pointer to Done"`. Dispatch `{ type: "thread.merge_back", createdBy: "user", creationSource: "web", commandId: "merge-side-chat", sourceThreadId: side, targetThreadId: lesson, sourcePoint: { type: "latest_stable" } }` and flip it. The `_tag` is `"OrchestratorDispatchError"`, the cause is `"Use Done for side chats."`, and the lesson's `contextTransfers` is `[]`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts -t "merge-back from a side chat"`. Expected: FAIL, because the cause is `No fork transfer exists between …`.
- [ ] **Step 3: Implement** the refusal, with the one-line comment "a merge-back would replay the side chat into the lesson".
- [ ] **Step 4: Run the checks and confirm they pass.** Run both side-chat integration files, then `vp run --filter t3 typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/orchestration-v2/testkit/SideChatDone.integration.test.ts && git commit -m "feat(server): refuse merge-back from side chats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 32: Advertise the `sideChats` capability

The server now handles `thread.side_chat.open` and `thread.side_chat.done`, so the flag can go on.

**Files:**
- Modify `packages/contracts/src/environment.ts:154`.
- Modify `apps/server/src/environment/ServerEnvironment.ts:268`.
- Test: `apps/server/src/environment/ServerEnvironment.test.ts:226`, in `"persists the environment id across service restarts"`.

**Interfaces:**
- Produces: `ExecutionEnvironmentCapabilities.sideChats?: boolean` (`Schema.optionalKey(Schema.Boolean)`). A fork server sends `true`. Clients gate Ask, the Map launcher, the palette entries and Done on `capabilities.sideChats === true`.

- [ ] **Step 1: Write the failing test.** `expect(second.capabilities.sideChats).toBe(true);`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/server/src/environment/ServerEnvironment.test.ts -t "persists the environment id"`. Expected: FAIL, because the value is `undefined`.
- [ ] **Step 3: Implement.** Add the field, with the doc comment "Server handles thread.side_chat.* commands; older servers reject them, so clients hide Ask in side chat", and set `sideChats: true,`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/server/src/environment/ServerEnvironment.test.ts packages/contracts/src/environment.test.ts && vp run --filter @t3tools/contracts typecheck && vp run --filter t3 typecheck`, then `vp run check:changed origin/main` for the server phase. Expected: PASS, and `check:changed` is clean.
- [ ] **Step 5: Commit.** `git add packages/contracts/src/environment.ts apps/server/src/environment/ServerEnvironment.ts apps/server/src/environment/ServerEnvironment.test.ts && git commit -m "feat(server): advertise the side chats capability" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Phase 4: Web, the side-chat panel

### Task 33: Selection toolbar offers "Ask in side chat" next to Cite

**Files:**
- Modify `apps/web/src/components/chat/AssistantSelectionToolbar.tsx:1-211`.
- Modify `apps/web/src/components/chat/MessagesTimeline.logic.ts`: append after `:2402`.
- Modify `apps/web/src/components/chat/MessagesTimeline.tsx`: `:176-182` (props), `:285-288` and `:1069-1075`.
- Test: create `AssistantSelectionToolbar.browser.test.tsx`. Mirror `MessagesTimeline.browser.test.tsx`, and use the `data-assistant-citation-*` DOM of `ComposerPromptEditorTiptap.citationDraft.browser.test.tsx`.
- Test: `MessagesTimeline.logic.test.ts`.

**Interfaces:**
- Consumes: `SIDE_CHAT_EXCERPT_MAX_CHARS`.
- Produces:
  - `AssistantSelectionToolbar` optional props:
    - `onAskInSideChat?: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean`. The Ask action renders only when this is given. Callers omit it without the capability.
    - `askPending?: boolean`
    - `streamingMessageId?: MessageId | null`
  - DOM: a container with `role="toolbar" aria-label="Selection actions"`. The buttons are `"Cite selection in composer"` and `"Ask in side chat"`. Above 4000 chars, Ask is named `"Selection is too long to ask about"` and reads "Shorten selection".
  - `MessagesTimelineProps.onAskInSideChat?` (same type) and `askInSideChatPending?: boolean`. `ThreadTimeline` forwards both.
  - `streamingAssistantMessageId(entries: ReadonlyArray<TimelineEntry>): MessageId | null`.

- [ ] **Step 1: Write the failing tests.**
  - Logic, `describe("streamingAssistantMessageId")`: it returns `"b"` for `[a done, user, b streaming]`, and `null` once nothing streams.
  - Browser. A `Reply` harness renders a viewport (`data-assistant-citation-viewport`) and a source (`data-assistant-citation-source="assistant-1"`, environment `environment-local`, thread `lesson-1`) holding `<p>The agent reads its observation space every step.</p>`, with the toolbar `onCite={() => true}`. `select(container, 20, 37)` sets a DOM range. Queries go through `page`, because the toolbar portals.
    - `"offers Cite and Ask in side chat, reachable with Tab and the arrow keys"`: Tab focuses Cite, ArrowRight moves to Ask, and ArrowRight again wraps to Cite.
    - `"asks about the selected text and clears the selection"`:
      - `onAskInSideChat` is called with `{ version: 1, environmentId, threadId: "lesson-1", messageId: "assistant-1", text: "observation space", start: 20, end: 37, prefix: "The agent reads its ", suffix: " every step." }` and `expect.objectContaining({ source: expect.any(HTMLElement) })`.
      - The selection is collapsed, and the toolbar is gone.
    - `"keeps Ask disabled while the reply streams and says why"`: with `streamingMessageId="assistant-1"`, Ask has `aria-disabled="true"` and `aria-description="Available when this reply finishes"`, and a click does nothing.
    - `"keeps Ask disabled while another side chat is starting"`: `askPending` gives the description `"Starting side chat…"`.
    - `"reads Shorten selection above 4,000 characters but still cites"`: a 4001-char selection gives the button `"Selection is too long to ask about"` with text "Shorten selection", and Cite stays enabled.
    - `"offers only Cite when the environment has no side chats"`: rendered without `onAskInSideChat`, `page.getByRole("button", { name: "Cite selection in composer" })` is visible and `page.getByRole("button", { name: "Ask in side chat" })` is not in the document.
    - `"dismisses both actions on Escape"`: with focus on Ask, Escape removes `page.getByRole("toolbar", { name: "Selection actions" })` from the document, `onAskInSideChat` and `onCite` were not called, and `window.getSelection()?.toString()` is still `"observation space"` (Escape behaves as today, design §6: it dismisses the toolbar and keeps the selection; only Cite and Ask clear it).
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/chat/AssistantSelectionToolbar.browser.test.tsx apps/web/src/components/chat/MessagesTimeline.logic.test.ts -t "Ask|streamingAssistantMessageId|Escape|Cite"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The toolbar becomes a container. Pointer-down `preventDefault`, `stopPropagation` and Escape → `dismiss()` move onto the container.
  - The Tab capture (`:144-163`) focuses the first enabled button. Focus is roving: `tabIndex` 0/−1, with ArrowLeft/ArrowRight cycling.
  - Ask is never natively `disabled`. It uses `aria-disabled` and `aria-description`, with a `Tooltip`/`TooltipTrigger render={<Button size="xs" variant="glass" …/>}` popup only while blocked, and the icon `MessageCircleQuestionIcon`.
  - Blocking reasons, in order:
    1. Too long: `"Side chats take up to 4,000 characters"`.
    2. Streaming: `"Available when this reply finishes"`.
    3. Pending: `"Starting side chat…"`.
  - The `ask` handler mirrors `cite`: on success it clears the selection and dismisses.
  - `MessagesTimeline` passes `askPending` and `streamingMessageId: streamingAssistantMessageId(timelineEntries)` only when `onAskInSideChat` is set. Default `askInSideChatPending = false` (`exactOptionalPropertyTypes`).
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, `vp run --filter @t3tools/web typecheck`, and `vp lint` on the three source files. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/chat/AssistantSelectionToolbar.tsx apps/web/src/components/chat/AssistantSelectionToolbar.browser.test.tsx apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/chat/MessagesTimeline.logic.ts apps/web/src/components/chat/MessagesTimeline.logic.test.ts && git commit -m "feat(web): offer Ask in side chat next to Cite" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 34: Selection toolbar stays inside the right-panel sheet

**Files:**
- Modify `AssistantSelectionToolbar.tsx`: the positioning effect and the portal target.
- Test: `AssistantSelectionToolbar.browser.test.tsx`.

**Interfaces:**
- Produces: below 980px, the toolbar portals into the `[data-slot="sheet-popup"]` ancestor of its viewport (`ui/sheet.tsx:108`), so the sheet's focus trap and outside-press dismissal don't break Cite or Ask.

- [ ] **Step 1: Write the failing test** `"stays inside the right-panel sheet so the sheet's focus trap keeps it usable"`. Render `Reply` inside a fixed `data-slot="sheet-popup"` div and select. `toolbar().element().parentElement` is the sheet element.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/web/src/components/chat/AssistantSelectionToolbar.browser.test.tsx -t "sheet"`. Expected: FAIL, because the parent is `document.body`.
- [ ] **Step 3: Implement.**
  - `portalTarget = viewport?.closest<HTMLElement>('[data-slot="sheet-popup"]') ?? null`.
  - Inside a sheet, use `absolute` positioning, with the sheet's `getBoundingClientRect()` left and top subtracted from the clamped `x`/`y`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/chat/AssistantSelectionToolbar.tsx apps/web/src/components/chat/AssistantSelectionToolbar.browser.test.tsx && git commit -m "fix(web): keep the selection toolbar inside the right-panel sheet" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 35: Right-panel side-chat and Map surfaces (store, version 15, reopen, tab titles)

**Files:**
- Modify `apps/web/src/rightPanelStore.ts`:
  - `:15-24`: the kinds.
  - `:36-83`: the union.
  - `:85-86`: `RIGHT_PANEL_STORAGE_VERSION = 15`.
  - `:130-133`, `:194-197`: `open`/`toggle` accept `"thread-map"` and not `"side-chat"`.
  - `:218-231`: `singletonSurface`.
  - `:465-508`: migration.
  - New actions after `navigateFolder` (`:778-805`) and `reconcileFileSurfaces` (`:1000-1022`).
- Modify `closedViewStore.ts:62-99`, `reopenClosedView.ts:119-139`, `components/RightPanelTabs.tsx:28-38,100-149,545-581,615-660,1292`, and `components/chat/RightPanelSurfaceContent.tsx:83-223`. Both new cases return `null` until Tasks 45 and 49.
- Test: `rightPanelStore.test.ts`, `closedViewStore.test.ts`, `reopenClosedView.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  | { id: `side-chat:${string}`; kind: "side-chat"; threadId: string; trail?: string[] }   // id = side-chat:<top-level side chat>
  | { id: "thread-map"; kind: "thread-map" }
  export type SideChatSurface = Extract<RightPanelSurface, { kind: "side-chat" }>;
  export function sideChatSurfaceId(topThreadId: string): SideChatSurface["id"];
  export function sideChatSurfaceTopThreadId(surface: Pick<SideChatSurface, "id">): string;
  export function normalizeSideChatSurface(value: unknown): SideChatSurface | null;
  export function hasSideChatSurfaces(surfaces: readonly RightPanelSurface[]): boolean;
  // store actions
  openSideChat: (ref: ScopedThreadRef, target: { readonly topThreadId: string; readonly threadId: string }, automatic?: boolean) => void;
  navigateSideChat: (ref: ScopedThreadRef, surfaceId: string, targetPath: readonly string[], fromPath: readonly string[]) => void;
  closeFailedSideChat: (ref: ScopedThreadRef, threadId: string, fallbackThreadId: string | null) => void;
  reconcileSideChatSurfaces: (ref: ScopedThreadRef, liveThreadIds: ReadonlySet<string>, mapAvailable: boolean) => void;
  ```
  - `threadId` is the side chat shown, which may be nested.
  - `trail` holds the side-chat ids from the top down to the deepest one visited. It is kept while walking up, like `folderTrail`.
  - Store paths never include the lesson.
  - `RightPanelTabsProps.sideChatLabelsById?: ReadonlyMap<string, string>`. A tab's title is `label ?? "Side chat"`, and the Map's is `"Map"`. The icons are `MessageCircleQuestion` and `MapIcon`.

- [ ] **Step 1: Write the failing tests**, in `describe("side chat surfaces")` on `refA`.
  - `"opens one tab per top-level side chat and shows nested ones in place"`: after `open("diff")`, `openSideChat(side-1)` and `openSideChat({ top: side-1, threadId: nested-1 })`, the surfaces are `[diff, { id: "side-chat:side-1", kind: "side-chat", threadId: "nested-1" }]`.
  - `"walks the breadcrumb up and back down in one tab"`:
    - From `nested-2`, navigating to `["side-1"]` keeps `trail: ["side-1","nested-1","nested-2"]`.
    - Navigating down to `nested-1` keeps the trail.
    - Navigating to the trail's end drops the trail.
    - A different branch `["side-1","other"]` drops the trail.
  - `"sends a failed nested open back to its parent and drops a failed top-level open without recording it"`: the active surface is `side-chat:side-1` with `threadId` `side-1`, and the closed-view entries are `[]`.
  - `"keeps only tabs whose side chats still exist and drops the Map without side chats"`: `reconcile(new Set(["side-1"]), true)` keeps `side-1`, reset to `threadId: "side-1"`, plus the Map. `reconcile(new Set(), false)` gives `{ isOpen: false, activeSurfaceId: null, surfaces: [] }`.
  - `"keeps saved side-chat and Map tabs and drops malformed ones when upgrading to version 15"`: the version is 15. Migrating keeps a valid side chat with its trail and `{ id: "thread-map", kind: "thread-map" }`, and drops `threadId: 5`, `trail: [1]` and `{ id: "map", kind: "thread-map" }`.
  - `closedViewStore.test.ts`:
    - Add the malformed entries `{ kind: "side-chat", id: "side-chat:x" }` and `{ kind: "thread-map", id: "map" }` to the `it.each` list.
    - `"restores closed side-chat and Map tabs from storage"`: `remember` `{ kind: "panel-tab", threadRef: refA, surface: { id: "side-chat:side-1", kind: "side-chat", threadId: "nested-1", trail: ["side-1", "nested-1"] } }` and `{ kind: "panel-tab", threadRef: refA, surface: { id: "thread-map", kind: "thread-map" } }`, write the store's entries to its persist storage and rehydrate as the `it.each` above does. `entries` deep-equals the two remembered entries with their returned ids, newest first.
  - `reopenClosedView.test.ts`: `"reopens a closed side chat where it was, even without a workspace"`. With `workspaceAvailable: false`, the result is `true` and the surfaces are `[{ id: "side-chat:side-1", kind: "side-chat", threadId: "nested-1" }]`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/rightPanelStore.test.ts apps/web/src/closedViewStore.test.ts apps/web/src/reopenClosedView.test.ts -t "side|Map"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `openSideChat`: `automatic ? automaticUpdate : userAction`. Replace the surface in place or append it, then activate it.
  - `navigateSideChat`: a user action, and a no-op for an unknown surface. With `base = surface.trail ?? fromPath`, keep `[...base]` as the trail when `base` extends `targetPath`.
  - `closeFailedSideChat`: an automatic update. Remove the `sideChatSurfaceId(threadId)` surface (with `closeSurface`'s active fallback), or set the surface showing it to `fallbackThreadId` with no trail.
  - `reconcileSideChatSurfaces`: an automatic update.
    - Drop the Map when `!mapAvailable`, and drop dead top ids.
    - Replace a dead `threadId` with the top id.
    - Cut the trail before its first dead id, and keep it only while it still extends past `threadId`.
    - Return `current` when nothing changed.
  - Migration: normalize `side-chat` entries, and keep `thread-map` only with `id === "thread-map"`.
  - `closedViewStore` adds `"thread-map"` to the `surface.id === surface.kind` case and validates `side-chat` with `normalizeSideChatSurface`.
  - `reopenClosedView`: `side-chat` calls `openSideChat(ref, { topThreadId: sideChatSurfaceTopThreadId(surface), threadId: surface.threadId })`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the three test files, then `vp run --filter @t3tools/web typecheck`. The exhaustive switches must compile. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/rightPanelStore.ts apps/web/src/rightPanelStore.test.ts apps/web/src/closedViewStore.ts apps/web/src/closedViewStore.test.ts apps/web/src/reopenClosedView.ts apps/web/src/reopenClosedView.test.ts apps/web/src/components/RightPanelTabs.tsx apps/web/src/components/chat/RightPanelSurfaceContent.tsx && git commit -m "feat(web): side-chat and map surfaces in the right panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 36: A quiet, stable list of a lesson and its side chats

One selector serves the panel, the Map, the reconcile pass and the overlap check.

**Files:**
- Modify `apps/web/src/state/entities.ts`: append after `:449`, next to `relationshipShellsAtomFamily` (`:430-449`).
- Modify `apps/web/src/test-fixtures.ts`: append after `makeThreadFixture` (`:138`).
- Test: create `apps/web/src/state/entities.sideChatShells.test.ts`. Mirror `entities.relationshipShells.test.ts`.

**Interfaces:**
- Consumes: `EnvironmentThreadShell.sideChat` (Task 4) and `environmentThreadShells.quietThreadShellsAtom`.
- Produces:
  ```ts
  export function selectSideChatTreeShells(lessonRef: ScopedThreadRef, shells: ReadonlyArray<EnvironmentThreadShell>): ReadonlyArray<EnvironmentThreadShell>;
  export function useSideChatTreeShells(lessonRef: ScopedThreadRef | null): ReadonlyArray<EnvironmentThreadShell>;   // [] for null
  export function readSideChatTreeShells(lessonRef: ScopedThreadRef): ReadonlyArray<EnvironmentThreadShell>;
  // test-fixtures.ts
  export function makeSideChatThreadFixture(input: { readonly id: ThreadId; readonly lessonId: ThreadId; readonly parentId?: ThreadId; readonly messageId?: MessageId; readonly start?: number; readonly end?: number; readonly label?: string; readonly state?: "open" | "done"; readonly noteStatus?: "generating" | "ready" | "none" | "failed" | null; readonly environmentId?: EnvironmentId; readonly createdAt?: string; readonly archivedAt?: string }): Thread;
  ```
  - The selector keeps shells in the lesson's environment that are not archived or deleted, where `id === lessonRef.threadId || sideChat?.lessonThreadId === lessonRef.threadId`, in input order. The lesson shell comes along so `deriveSideChatTree` can label the root.
  - The atom family is keyed by `threadKey(ref)` and labelled `web-side-chat-tree-shells:${key}`. It returns the previous array when `arrayElementsEqual` holds, so streaming ticks never re-render readers.
  - The fixture builds lineage `fork` under `parentId ?? lessonId`, and an anchor `{ threadId: parent, messageId: messageId ?? "assistant-1", start: start ?? 3, end: end ?? 20, prefix: "An ", suffix: " is what the agent can see." }` with `excerptLength: 17`.

- [ ] **Step 1: Write the failing test** `"keeps the lesson and its live side chats from its own environment"`. The input is the lesson, `first`, `nested` (under `first`), `earlier`, `other-message`, `archived`, `elsewhere` (another lesson) and `remote` (another environment). The result ids are `["lesson","first","nested","earlier","other-message"]`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/web/src/state/entities.sideChatShells.test.ts`. Expected: FAIL, because the selector is not exported.
- [ ] **Step 3: Implement** the selector, the atom family over `quietThreadShellsAtom`, the hooks (`null` reads `EMPTY_THREAD_SHELLS_ATOM`), `readSideChatTreeShells` through `appAtomRegistry`, and the fixture.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/web/src/state/entities.sideChatShells.test.ts apps/web/src/state/entities.relationshipShells.test.ts && vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/state/entities.ts apps/web/src/state/entities.sideChatShells.test.ts apps/web/src/test-fixtures.ts && git commit -m "feat(web): quiet list of a lesson's side chats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 37: Side-chat panel logic (paths, breadcrumb, status lines, anchor citation)

**Files:**
- Create `apps/web/src/components/sideChat/sideChatPanel.logic.ts`.
- Test: create `sideChatPanel.logic.test.ts`.

**Interfaces:**
- Consumes: `SideChatTreeRow` (Task 5).
- Produces:
  ```ts
  export type SideChatCrumb = { readonly threadId: string; readonly label: string; readonly role: "lesson" | "ancestor" | "current" | "forward" };
  export function sideChatPath(rows: ReadonlyArray<SideChatTreeRow>, threadId: string): ReadonlyArray<SideChatTreeRow>; // lesson … threadId; [] if absent; cycle-safe
  export function sideChatSurfacePath(rows: ReadonlyArray<SideChatTreeRow>, threadId: string): ReadonlyArray<string>; // without the lesson
  export function topSideChatId(rows: ReadonlyArray<SideChatTreeRow>, threadId: string): string | null;
  export function sideChatBreadcrumb(rows: ReadonlyArray<SideChatTreeRow>, threadId: string, trail: ReadonlyArray<string> | undefined): ReadonlyArray<SideChatCrumb>;
  export function sideChatStatusLine(sideChat: Pick<OrchestrationV2ThreadShellSideChat, "state" | "noteStatus"> | undefined, note: string | null): string | null;
  export function sideChatComposerStatus(input: { readonly shellExists: boolean; readonly openingStatus: OrchestrationV2SideChatOpening["status"] | null; readonly runActive: boolean }): "Starting side chat…" | "Preparing context…" | null;
  export function sideChatAnchorCitation(environmentId: EnvironmentId, anchor: OrchestrationV2SideChatAnchor, excerpt: string): AssistantCitation;
  export function sideChatAwaitingInput(shells: ReadonlyArray<Pick<EnvironmentThreadShell, "id" | "sideChat" | "hasPendingApprovals" | "hasPendingUserInput">>): ThreadId | null;
  export function appendComposerSnippet(prompt: string, text: string): string;
  export function shouldFinishSideChatOnClose(shell: Pick<EnvironmentThreadShell, "sideChat" | "latestUserMessageAt"> | null): boolean;
  export function lessonSideChatWaitLabel(input: { readonly lessonThreadId: ThreadId; readonly activityRunStatus: OrchestrationV2Run["status"] | null; readonly shells: ReadonlyArray<Pick<EnvironmentThreadShell, "sideChat">> }): "Adding side-chat note…" | null;
  ```

- [ ] **Step 1: Write the failing tests.** The rows are lesson `"Learning RL environments"`, `side-1` "observation space", `nested-1` "Box" under side-1, and `side-2` "reward".
  - `sideChatBreadcrumb(rows, "nested-1", undefined)` gives `[{lesson-1,"Lesson",lesson},{side-1,"observation space",ancestor},{nested-1,"Box",current}]`.
  - `(rows, "side-1", ["side-1","nested-1"])` gives roles `[lesson, current, forward]`. An unknown id gives `[]`.
  - `sideChatSurfacePath(rows, "nested-1")` is `["side-1","nested-1"]`. `topSideChatId(rows, "nested-1")` is `"side-1"`, and for the lesson it is `null`.
  - `sideChatStatusLine` cases:

    | Input | Line |
    |---|---|
    | open | `null` |
    | done / generating | `"Writing note…"` |
    | done / ready, with a note | `"Sent to lesson: <note>"` |
    | done / none | `"No note needed"` |
    | done / failed | `"Couldn't write the note"` |
  - `sideChatComposerStatus`:
    - No shell gives `"Starting side chat…"`.
    - Pending with a run active gives `"Preparing context…"`.
    - Pending with no run gives `null`, and ready with a run gives `null`.
  - `sideChatAnchorCitation` rebuilds `{ version: 1, environmentId, threadId, messageId, text: excerpt, start, end, prefix, suffix }` and drops `turnItemId`.
  - `sideChatAwaitingInput` returns the side chat with pending input or approval, ignoring non-side chats. The fixture expects `"nested-1"`.
  - `appendComposerSnippet`: `("", s)` is `s`, `("Why", s)` is `"Why " + s`, and `("Why ", s)` is `"Why " + s`.
  - `shouldFinishSideChatOnClose` is `true` only for an open side chat with `latestUserMessageAt === null`. It is `false` for a done side chat, a non-side-chat or `null`.
  - `lessonSideChatWaitLabel` returns `"Adding side-chat note…"` only when the status is `"starting"` and some shell with `sideChat.anchor.threadId === lessonThreadId` has `noteStatus: "generating"`. It is `null` for `"running"` or when no note is generating.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/sideChatPanel.logic.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement.** `sideChatPath` walks `parentId` with a visited `Set`. Forward crumbs are `trail.slice(trail.indexOf(threadId) + 1)` mapped to rows.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/sideChatPanel.logic.ts apps/web/src/components/sideChat/sideChatPanel.logic.test.ts && git commit -m "feat(web): side-chat breadcrumb and status logic" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 38: Optimistic open, overlap reuse and panel navigation helpers

**Files:**
- Create `apps/web/src/components/sideChat/sideChatSelection.ts`, `sideChatNavigation.ts`, `pendingSideChatStore.ts` and `openSideChat.ts`.
- Tests: create `sideChatSelection.test.ts` and `openSideChat.test.ts`. Mirror `reopenClosedView.test.ts`: `AsyncResult` from `effect/reactivity`, `Cause`, and store resets in `setup()`.

**Interfaces:**
- Consumes:
  - Task 6: `OpenSideChatInput`.
  - Task 35: the store actions.
  - Task 36: `readSideChatTreeShells`.
  - Task 37: `topSideChatId` and `sideChatSurfacePath`.
  - `deriveSideChatTree`, `newThreadId`, `squashAtomCommandFailure`, `isAtomCommandInterrupted`, `AtomCommandResult`, and `useComposerDraftStore.clearComposerContent`.
- Produces:
  ```ts
  // sideChatSelection.ts
  export function sideChatAnchorFromCitation(citation: AssistantCitation): OrchestrationV2SideChatAnchor;
  export function findOverlappingSideChat(shells: ReadonlyArray<Pick<EnvironmentThreadShell, "id" | "sideChat">>, selection: Pick<AssistantCitation, "threadId" | "messageId" | "start" | "end">): ThreadId | null;
  // sideChatNavigation.ts (Task 52 extends this module)
  export function revealSideChat(lessonRef: ScopedThreadRef, threadId: ThreadId, automatic?: boolean): void; // top = topSideChatId(deriveSideChatTree(readSideChatTreeShells(lessonRef), lesson), id) ?? id; openSideChat + setMaximized(false)
  export function leaveSideChat(lessonRef: ScopedThreadRef, surface: SideChatSurface, rows: ReadonlyArray<SideChatTreeRow>): void; // parent side chat in place, else closeSurface
  // pendingSideChatStore.ts (zustand, memory only)
  export interface PendingSideChat { readonly threadId: ThreadId; readonly lessonThreadKey: string; readonly citation: AssistantCitation; readonly status: "starting" | "started" }
  export const usePendingSideChatStore; // { byThreadKey; begin(key, entry); markStarted(key); remove(key); prune(lessonThreadKey, liveThreadIds) }
  export function selectStartingSideChat(state, lessonThreadKey: string | null): boolean;
  export function pendingSideChatThreadIds(state, lessonThreadKey: string): ReadonlyArray<ThreadId>;
  // openSideChat.ts
  export type OpenSideChatRunner = (value: { readonly environmentId: EnvironmentId; readonly input: OpenSideChatInput }) => Promise<AtomCommandResult<unknown, unknown>>;
  export interface OpenSideChatFromSelectionInput { readonly lessonRef: ScopedThreadRef; readonly citation: AssistantCitation; readonly sideChatShells: ReadonlyArray<EnvironmentThreadShell>; readonly topThreadId: string | null; readonly run: OpenSideChatRunner }
  export type OpenSideChatOutcome = { _tag: "Reused"; threadId } | { _tag: "Opened"; threadId } | { _tag: "Failed"; message: string } | { _tag: "Interrupted" };
  export function openSideChatFromSelection(input: OpenSideChatFromSelectionInput): Promise<OpenSideChatOutcome>;
  export function askInSideChat(input: OpenSideChatFromSelectionInput): boolean; // fires it; toasts "Couldn't start the side chat" on Failed
  ```

- [ ] **Step 1: Write the failing tests.**
  - `sideChatAnchorFromCitation` keeps the selector and drops the text and comment.
  - `findOverlappingSideChat` finds a shell whose anchor overlaps `[25, 40)` in the same reply. It ignores highlights that only touch the selection, other replies, and highlights asked in another thread.
  - `"opens the side-chat tab before the server answers, un-maximizes the panel and sends the anchor"`, with a deferred runner:
    - `run` is called with `{ environmentId, input: { threadId, anchorThreadId: "lesson-1", anchor: { threadId: "lesson-1", messageId, start: 20, end: 37, prefix, suffix }, excerpt: "observation space" } }`.
    - The panel is open on `side-chat:<threadId>`, and `maximized` is undefined.
    - The pending entry is `starting`. After success the result is `{ _tag: "Opened", threadId }` and the entry is `started`.
    - `prune` with the live id removes the entry.
  - `"closes the tab and reports why when the server refuses, without recording a closed view"`: the result is `{ _tag: "Failed", message: "The highlighted reply is still streaming." }`. The surfaces, the pending entries and the closed views are all empty.
  - `"reopens the existing side chat when the selection overlaps its highlight"`: with `makeSideChatThreadFixture({ id: "side-1", lessonId: "lesson-1", messageId: "assistant-1", start: 22, end: 40, state: "done", noteStatus: "none" })`, the result is `Reused`, `run` is never called, and the surface is `side-chat:side-1`.
  - `"opens a nested side chat inside its parent's tab and falls back to the parent on failure"`: while it is pending, the single `side-chat:side-1` surface shows the new id. On failure it shows `side-1` again.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/sideChatSelection.test.ts apps/web/src/components/sideChat/openSideChat.test.ts`. Expected: FAIL, because the modules do not exist.
- [ ] **Step 3: Implement.** This is plain async module code: no try/finally, and it branches on `result._tag`.
  1. On an overlap, call `revealSideChat` and return `Reused`.
  2. Otherwise, with `threadId = newThreadId()`:
     - `begin` the pending entry.
     - `openSideChat(lessonRef, { topThreadId: topThreadId ?? threadId, threadId })` and `setMaximized(false)`.
     - Await `run`.
  3. On failure:
     - `remove` the entry.
     - Call `closeFailedSideChat(lessonRef, threadId, topThreadId === null ? null : citation.threadId)`.
     - Clear the side chat's draft.
     - Return `Interrupted`, or `Failed` with the squashed message (`"The side chat could not start."` when the failure is not an `Error`).
  4. On success, `markStarted`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/sideChatSelection.ts apps/web/src/components/sideChat/sideChatSelection.test.ts apps/web/src/components/sideChat/sideChatNavigation.ts apps/web/src/components/sideChat/pendingSideChatStore.ts apps/web/src/components/sideChat/openSideChat.ts apps/web/src/components/sideChat/openSideChat.test.ts && git commit -m "feat(web): open side chats optimistically from a selection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 39: SideChatTimeline (ThreadTimeline without the held-timeline cache)

**Files:**
- Modify `apps/web/src/components/chat/ThreadTimeline.tsx:19-65`: the `holdTimeline` prop.
- Create `apps/web/src/components/sideChat/SideChatTimeline.tsx`.
- Modify `apps/web/src/index.css:2450-2457`: a sibling rule in the same `@layer components`.
- Test: create `SideChatTimeline.browser.test.tsx`. Mirror the sized container in `MessagesTimeline.browser.test.tsx` and the hoisted `state` and entity mocks in `QueuedRunsControl.browser.test.tsx`.

**Interfaces:**
- Consumes: Task 33 props, `deriveThreadActivityRun`, `deriveThreadStructureRuntime`, `deriveRunlessWorkStartedAt`, `derivePhase`, `isLatestRunSettled` and `openExpandedImagePreview`.
- Produces:
  - `ThreadTimeline` gains `holdTimeline?: boolean` (default `true`). With `false` it skips `resolveThreadSwitchTimeline` and `rememberReadyThreadTimeline`.
  - `SideChatTimeline(props: { lessonRef; sideChatRef; detailRef: ScopedThreadRef | null; projection: ThreadStructure | null; detailLoading: boolean; optimisticMessages: ReadonlyArray<ChatMessage>; listRef: React.RefObject<LegendListRef | null>; citationRequest: AssistantCitationRequest | null; askInSideChatPending: boolean; onCiteAssistantText; onAskInSideChat: (…) => boolean | undefined; onOpenThread: (threadId: ThreadId) => void; workspaceRoot: string | undefined })`.
  - CSS: `[data-side-chat-panel] .messages-timeline-scroll { padding-inline: 0.75rem; }`.

- [ ] **Step 1: Write the failing test** `"shows the side chat's replies without entering the lesson's held timeline"`. Use `makeStreamingTimelineFixture("A Box is a bounded space of numbers.")` in an 800×480 container. The text is visible, and `peekRememberedThreadTimeline(scopedThreadKey(sideChatRef))` and `peekHeldThreadTimeline()` are both `null`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/web/src/components/sideChat/SideChatTimeline.browser.test.tsx`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement.** Render `<ThreadTimeline holdTimeline={false} …/>` with these props:
  - Keys: `activeThreadKey` and `routeThreadKey` are both the side chat's key.
  - Run state as ChatView derives it (`:746-753`, `:1403-1408`).
  - No-ops for fork, rollback, revert, turn diff and worktree. `supportsConversationRollback={false}`.
  - Leave `onUseArtifactTemplate` and `onSendAppMessage` unset, so nothing targets the lesson composer.
  - Image previews open in the lesson's dialog host.
  - Anchor `null`, `liveFollowEnabled`, and wrapper `className="h-full min-h-0"`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/web/src/components/sideChat/SideChatTimeline.browser.test.tsx apps/web/src/components/chat/MessagesTimeline.browser.test.tsx && vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/chat/ThreadTimeline.tsx apps/web/src/components/sideChat/SideChatTimeline.tsx apps/web/src/components/sideChat/SideChatTimeline.browser.test.tsx apps/web/src/index.css && git commit -m "feat(web): side-chat timeline outside the held-timeline cache" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 40: Shared send plan for the side-chat composer

**Files:**
- Modify `apps/web/src/components/chat/composerSend.logic.ts`: append after `:81`.
- Test: `composerSend.logic.test.ts`.

**Interfaces:**
- Consumes: `formatOutgoingPrompt`, `withMessageContext` and `deriveComposerSendState` (`ChatView.logic.ts:1379,1578,848`), `getComposerPromptLengthValidationMessage`, and `ProviderInstanceEntry`.
- Produces:
  ```ts
  export type SideChatSendPlan =
    | { readonly _tag: "Blocked"; readonly reason: "no-operate-scope" | "in-flight" | "starting" | "provider-unavailable" | "run-active" | "empty" }
    | { readonly _tag: "AnswerPendingInput" }
    | { readonly _tag: "Invalid"; readonly message: string }
    | { readonly _tag: "Ready"; readonly outgoingText: string; readonly message: { readonly text: string; readonly context?: OrchestrationMessageContext } };
  export function planSideChatSend(input: { canOperate: boolean; sendInFlight: boolean; shellReady: boolean; answeringPendingUserInput: boolean; providerEntry: Pick<ProviderInstanceEntry, "driverKind" | "enabled" | "isAvailable" | "models"> | undefined; model: string; runActive: boolean; prompt: string; supportsInlineMessageContext: boolean }): SideChatSendPlan;
  ```
  The checks run in this order: scope, in-flight, starting, pending-input answer, provider, run active, empty, then length.

- [ ] **Step 1: Write the failing tests.**
  - `"sends the trimmed prompt as the side chat's message"`: the result is `{ _tag: "Ready", outgoingText: "What is a Box?", message: { text: "What is a Box?" } }`.
  - `it.each` of the seven blocking overrides and their reasons.
  - The pending answer wins over `runActive`.
  - A prompt of `PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1` gives `{ _tag: "Invalid", message: getComposerPromptLengthValidationMessage(prompt) }`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/chat/composerSend.logic.test.ts -t "planSideChatSend"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `formatOutgoingPrompt({ provider: entry.driverKind, model, models: entry.models, effort: null, text: prompt.trim() })` and `withMessageContext({ text, context: undefined, supportsInlineMessageContext })`. `useComposerSend` stays unchanged.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/chat/composerSend.logic.ts apps/web/src/components/chat/composerSend.logic.test.ts && git commit -m "feat(web): send plan for the side-chat composer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 41: SideChatComposer

**Files:**
- Create `apps/web/src/components/sideChat/SideChatComposer.tsx`.
- Test: create `SideChatComposer.browser.test.tsx`. Mirror the editor in `ComposerPromptEditorTiptap.citationDraft.browser.test.tsx` and the hoisted `vi.mock` of `use-orchestration-command` and `session` in `QueuedRunsControl.browser.test.tsx`.

**Interfaces:**
- Consumes:
  - Task 40: `planSideChatSend`.
  - Task 37: `sideChatComposerStatus` and `appendComposerSnippet`.
  - `ComposerPromptEditor`, `EMPTY_COMPOSER_CONTEXT_RECORDS` (`composerContextPresentation.tsx:84`), `draftSendState`, `threadEnvironment.startTurn`, `useOrchestrationCommand`, `useEnvironmentScope`, `composerSubmissionIntentForKey`, `formatAssistantCitationForComposer`, `primaryServerKeybindingsAtom` and `useEnvironmentSettings(env, (s) => s.sendShortcut)`.
- Produces:
  ```ts
  export interface SideChatComposerHandle { readonly focusAtEnd: () => void; readonly insertTextAtEnd: (text: string) => boolean; readonly citeAssistantText: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean }
  export function SideChatComposer(props: { sideChatRef: ScopedThreadRef; shell: EnvironmentThreadShell | null; providerEntry: ProviderInstanceEntry | undefined; openingStatus: OrchestrationV2SideChatOpening["status"] | null; runActive: boolean; answeringPendingUserInput: boolean; autoFocus: boolean; handleRef: React.RefObject<SideChatComposerHandle | null>; onAdvancePendingUserInput: () => void; onOptimisticMessage: (message: ChatMessage) => void; onOptimisticMessageFailed: (messageId: MessageId) => void; onPageScrollKeyDown: (key: "PageUp" | "PageDown") => void; onPageScrollKeyUp: (key: string) => void; onPageScrollRelease: () => void }): React.ReactElement;
  ```
  - The editor is `aria-label="Side chat message"` with placeholder "Ask a follow-up…". The send button is `aria-label="Send side chat message"`.
  - Blocked reasons go on the button's `aria-description`: `"Starting side chat…"`, `"Wait for this answer to finish"` and `"This side chat's provider is unavailable"`.

- [ ] **Step 1: Write the failing tests.** The `SHELL` uses `makeThreadFixture` (codex `gpt-5.4`, full-access, default), and `PROVIDER_ENTRY` comes from `deriveProviderInstanceEntries`.
  - `"keeps typing in the side chat's draft and holds Send while the side chat starts"`: with `shell={null}`, the editor is focused and typing works. "Starting side chat…" is visible, Send is disabled, and Enter does not dispatch. The draft is `"What is a Box?"`.
  - `"sends with the side chat's model and modes and no title seed"`:
    - Dispatch is called once with `{ environmentId, input: { threadId: "side-1", message: { messageId: expect.any(String), role: "user", text: "What is a Box?", attachments: [] }, modelSelection: { instanceId: CODEX, model: "gpt-5.4" }, runtimeMode: "full-access", interactionMode: "default", createdAt: expect.any(String) } }`.
    - The optimistic message is reported, and the draft is `""`.
  - `"restores the draft when the server refuses the message"`: the dispatch mock resolves to a failure result (not an interrupt). After Send, the side chat's draft equals `"What is a Box?"`, `onOptimisticMessageFailed` was called once with the optimistic message's id, and the toast "Couldn't send to the side chat" was shown.
  - `"blocks a second message while the side chat is still answering"`: the description is `"Wait for this answer to finish"`, and nothing is dispatched.
  - `"says it is preparing context while the opening summary is still being written"`: with `openingStatus="pending"` and `runActive`, `"Preparing context…"` is visible. After a rerender with `openingStatus="ready"`, it is not in the document.
  - `"quotes a cited selection into the side chat's own draft"`: the draft becomes `` `Why ${serializeAssistantCitation(citation)} ` ``.
  - `"offers no slash commands, attachments or model picker"` (design: Composer v1 is text and quotes only):
    - Typing `/` shows no `page.getByRole("listbox")`.
    - Pasting a PNG `File` (a `ClipboardEvent` whose `clipboardData` holds only the file) adds no attachment chip, and a following Send dispatches `message.attachments` equal to `[]`.
    - No button named like a model picker (`/model/i`) is rendered.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/SideChatComposer.browser.test.tsx`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement.** The draft lives in `useComposerDraftStore` under `sideChatRef`. Enter sends only when the submission intent is `"foreground"`. Composer v1 is text and quotes only, so the `ComposerPromptEditor` gets `skills={[]}` and `contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}`, and leaves `suggestionListId`, `activeSuggestionId`, `isPathQueryActive`, `buildContextClipboardFragment` and `importContextFragment` unset. Its `onPaste` inserts plain text only and never creates an attachment. Render no model picker, no attachment button and no interaction-mode toggle. `send()` is async, branches on result tags and has no try/finally:
  1. Mark `sendInFlight`.
  2. Push the optimistic row and clear the draft.
  3. Call `startTurn` with the shell's `modelSelection`, `runtimeMode` and `interactionMode`, and no `titleSeed` or `dispatchMode`.
  4. On failure, mark the row failed, restore the draft, and unless interrupted toast "Couldn't send to the side chat".

  `useImperativeHandle` provides the handle. An effect `[autoFocus, sideChatKey]` calls `focusAtEnd`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/SideChatComposer.tsx apps/web/src/components/sideChat/SideChatComposer.browser.test.tsx && git commit -m "feat(web): slim side-chat composer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 42: SideChatExcerpt (pinned, three lines, reveal)

**Files:**
- Create `apps/web/src/components/sideChat/SideChatExcerpt.tsx`.
- Test: create `SideChatExcerpt.browser.test.tsx`.

**Interfaces:**
- Produces: `SideChatExcerpt(props: { readonly text: string; readonly onReveal: () => void })`.
  - The quote is a button named `"Show this highlight where it was asked"`, clamped with `line-clamp-3`.
  - A `"Show more"` / `"Show less"` toggle with `aria-expanded` appears only when the clamped text overflows. Overflow is measured with `observeResize` while collapsed.

- [ ] **Step 1: Write the failing tests.**
  - `"clamps a long excerpt to three lines until expanded"`: the toggle's `aria-expanded` goes from false to true.
  - `"offers no toggle for a short excerpt"`: with `"observation space"`, `page.getByRole("button", { name: "Show more" })` is not in the document, and the `"Show this highlight where it was asked"` button's text is `"observation space"`.
  - `"reveals the highlight where it was asked"`: `onReveal` is called once.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/SideChatExcerpt.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use theme tokens only, no animation, and `<Button size="xs" variant="ghost">` for the toggle.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/SideChatExcerpt.tsx apps/web/src/components/sideChat/SideChatExcerpt.browser.test.tsx && git commit -m "feat(web): pinned side-chat excerpt" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 43: Input isolation for `[data-side-chat-panel]`

**Files:**
- Modify `apps/web/src/components/chat/composerFocusRedirect.ts:61-89`, `useChatShortcuts.ts:63-80`, `useComposerStash.ts:697-722` and `ChatView.tsx:2686` (`composerFocus`). `usePasteToFocusComposer.ts` needs no change: its default `"lesson"` scope refuses panel pastes.
- Test: `useChatShortcuts.browser.test.tsx`, and create `composerFocusRedirect.browser.test.tsx`.

**Interfaces:**
- Produces:
  ```ts
  export const SIDE_CHAT_PANEL_SELECTOR = "[data-side-chat-panel]";
  export type ComposerInputScope = "lesson" | "side-chat";
  export function shouldRedirectInputToComposer(event: Event, scope?: ComposerInputScope): boolean; // default "lesson"
  export function shouldTypeToFocusComposer(event: KeyboardEvent, scope?: ComposerInputScope): boolean;
  export function pasteTextToFocusComposer(event: ClipboardEvent, scope?: ComposerInputScope): string | null;
  export function isLessonComposerFocused(element: Element | null): boolean;
  ```
  - `"lesson"` refuses events whose path is inside the panel, and `"side-chat"` accepts only those.
  - `"side-chat"` ignores a floating layer (such as the open sheet) that contains the event target.
  - Inside the panel, the lesson's `useChatShortcuts` skips `modelPicker.toggle` and every `composer.*` command.
  - `composer.stash` is claimed (`preventDefault`) but never stashes the lesson's prompt.

- [ ] **Step 1: Write the failing tests.**
  - `"routes typing inside the side-chat panel to the side chat and outside it to the lesson"`: the four combinations give `false/true/true/false`.
  - `"lets the side chat take typing while its sheet is open"`.
  - `"never pastes into the lesson composer from inside the side-chat panel"`: the inserted values are `["outside"]`.
  - `"does not count the side chat's editor as the lesson composer"`.
  - In `useChatShortcuts.browser.test.tsx`, `"keeps keys and composer chords pressed in the side-chat panel off the lesson composer"`: after `a` and `ctrl+shift+m` inside a focused `data-side-chat-panel` section, `composerKeys` and `toggles` are `[]`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/chat/composerFocusRedirect.browser.test.tsx apps/web/src/components/chat/useChatShortcuts.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - After the `defaultPrevented` check, add `if ((scope === "side-chat") !== eventPathContainsSelector(event, SIDE_CHAT_PANEL_SELECTOR)) return false;`, and loop over every floating layer.
  - `isLessonComposerFocused` checks `data-testid="composer-editor"` and `closest(SIDE_CHAT_PANEL_SELECTOR) === null`. ChatView uses it for `composerFocus`.
  - Add the guards in `useChatShortcuts` and `useComposerStash`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests above plus `ComposerStashMenu.browser.test.tsx`, then `vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/chat/composerFocusRedirect.ts apps/web/src/components/chat/composerFocusRedirect.browser.test.tsx apps/web/src/components/chat/useChatShortcuts.ts apps/web/src/components/chat/useChatShortcuts.browser.test.tsx apps/web/src/components/chat/useComposerStash.ts apps/web/src/components/ChatView.tsx && git commit -m "fix(web): keep side-chat panel input away from the lesson composer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 44: Side-chat dividers and the note wait in timelines

Today the `handoff` turn item renders as `EnvironmentHandoffRow`, a provider-switch row (`V2LifecycleRow.tsx:132-140`). The design needs collapsed "Side chat context" and "Side-chat notes included" dividers that expand to show what the AI was given, and an "Adding side-chat note…" working label in the lesson.

**Files:**
- Create `apps/web/src/components/sideChat/SideChatContextDivider.tsx`.
- Modify `apps/web/src/components/chat/TimelineSystemDivider.tsx`: its action `<button>` only receives `aria-label` and `onClick`, so add the optional prop `actionExpanded?: boolean`, rendered as `aria-expanded={props.actionExpanded}` on that button (absent when undefined, so existing dividers render unchanged).
- Modify `apps/web/src/components/chat/V2LifecycleRow.logic.ts`, `V2LifecycleRow.tsx:132`, `timelineRowContext.ts:69-78` (`TimelineRowActivityState`), `TimelineWorkGroupRows.tsx:286-300` (`WorkingTimelineRow`) and `MessagesTimeline.tsx:186-196,946-951` (prop and activity state).
- Test: `V2LifecycleRow.logic.test.ts`, and create `SideChatContextDivider.browser.test.tsx`.

**Interfaces:**
- Consumes: `SIDE_CHAT_CONTEXT_HANDOFF_TITLE` and `SIDE_CHAT_NOTES_HANDOFF_TITLE` (Task 1).
- Produces:
  - `sideChatHandoffDividerLabel(item: OrchestrationV2TurnItem): string | null`. It returns the item's title when `item.type === "handoff"`, `item.strategy === "manual_context"`, and the title is one of the two constants. Otherwise it returns `null`.
  - `TimelineSystemDivider` gains `readonly actionExpanded?: boolean`.
  - `SideChatContextDivider(props: { readonly label: string; readonly summary: string })`. It renders `TimelineSystemDivider` with `actionLabel` `"Show what the AI was given"` / `"Hide"` and `actionExpanded={expanded}`. When expanded it shows the summary in a `whitespace-pre-wrap` block, in muted text.
  - `MessagesTimelineProps.sideChatWaitLabel?: "Adding side-chat note…" | null` (default `null`), carried on `TimelineRowActivityState.sideChatWaitLabel`. `WorkingTimelineRow` shows it, with the shimmer, ahead of the worktree and compaction labels.

- [ ] **Step 1: Write the failing tests.**
  - Logic: the label is `"Side chat context"` for a `manual_context` handoff with that title. It is `"Side-chat notes included"` for the notes title. It is `null` for a provider-switch handoff (another strategy or title) and for a non-handoff item.
  - Browser, `"collapses side-chat context until asked and shows what the AI was given"`. The summary `"Summary of the lesson so far:\nLESSON SUMMARY"` is not visible, and the `"Show what the AI was given"` button has `aria-expanded="false"`. After clicking it, the summary text is visible and the button (now named `"Hide"`) has `aria-expanded="true"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/chat/V2LifecycleRow.logic.test.ts apps/web/src/components/sideChat/SideChatContextDivider.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `V2LifecycleRow`, before `EnvironmentHandoffRow`: if `sideChatHandoffDividerLabel(item)` is non-null, render `<SideChatContextDivider label={…} summary={item.summary ?? ""} />`.
  - Thread `sideChatWaitLabel` through `MessagesTimeline` into the activity context, and render it in `WorkingTimelineRow`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests and `MessagesTimeline.browser.test.tsx`, then `vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/SideChatContextDivider.tsx apps/web/src/components/sideChat/SideChatContextDivider.browser.test.tsx apps/web/src/components/chat/TimelineSystemDivider.tsx apps/web/src/components/chat/V2LifecycleRow.logic.ts apps/web/src/components/chat/V2LifecycleRow.logic.test.ts apps/web/src/components/chat/V2LifecycleRow.tsx apps/web/src/components/chat/timelineRowContext.ts apps/web/src/components/chat/TimelineWorkGroupRows.tsx apps/web/src/components/chat/MessagesTimeline.tsx && git commit -m "feat(web): side-chat context and notes dividers, and the note wait label" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 45: SideChatPanel (breadcrumb, Done, Discard, status, pending requests)

**Files:**
- Create `apps/web/src/components/sideChat/SideChatPanel.tsx`.
- Modify `components/chat/RightPanelSurfaceContent.tsx:61-80`: the required `sideChat` prop and `case "side-chat"`.
- Modify `components/ChatView.tsx:3066-3116`: pass `sideChat={{ onFocusLesson: focusComposerStable }}`, where `focusComposerStable` is defined at `:1777`.
- Test: create `SideChatPanel.browser.test.tsx`. Mirror the mocks in `QueuedRunsControl.browser.test.tsx`: `entities` (`useSideChatTreeShells`, `useQuietThreadShell`, `useQuietThreadProjection`, `useThreadVisibleTurnItems`, `useThreadCheckpointSummaries`), plus `use-orchestration-command`, `use-atom-command` and `session`, all with spread originals and a `setup()` reset.

**Interfaces:**
- Consumes:
  - Task 35: store actions, `SideChatSurface`, `sideChatSurfaceTopThreadId`.
  - Task 36: `useSideChatTreeShells`.
  - Task 37: the logic exports.
  - Task 38: `askInSideChat`, `leaveSideChat`, `usePendingSideChatStore`.
  - Tasks 39, 41 and 42: the timeline, composer and excerpt components.
  - Task 43: the `"side-chat"` scope.
  - Task 6: `threadEnvironment.finishSideChat` and `openSideChat`.
  - Existing: `usePendingThreadRequests`, `ComposerPendingApprovalPanel`, `ComposerPendingApprovalActions`, `ComposerPendingUserInputPanel` (wired as in `ChatComposer.tsx:3520-3566`), `createPageScrollController`, `ComposerHandleContext`, `assistantCitationNavigation`, and `deriveProviderInstanceEntries`.
- Produces:
  - `SideChatPanel(props: { readonly lessonRef: ScopedThreadRef; readonly surface: SideChatSurface; readonly visible: boolean; readonly onFocusLesson: () => void })`.
  - `interface RightPanelSideChatProps { readonly onFocusLesson: () => void }`.
  - DOM:
    - The root is `<section data-side-chat-panel tabIndex={-1} aria-label="Side chat">` inside `<ComposerHandleContext value={null}>`.
    - `<nav aria-label="Side chat path">` holds the crumb buttons, the current one with `aria-current="page"`.
    - A `"Done"` button while the side chat is open.
    - A `"More side chat actions"` menu with a `"Discard"` item.
    - The status line uses `role="status"`.

- [ ] **Step 1: Write the failing tests.** `sideChatShell(id, anchorThreadId, label, overrides = {})` returns `{ ...makeSideChatThreadFixture({ id, lessonId: LESSON_ID, parentId: anchorThreadId, messageId: \`${anchorThreadId}-reply\`, label }), ...overrides }`. `renderPanel()` uses a 900×480 container. `crumb(name)` queries inside the nav.
  - `"shows a starting side chat with its excerpt and puts the cursor in its composer"`: render with `{ router: LESSON_PATH }` (`LESSON_PATH = "/environment-local/lesson-1"`, the lesson's route). With a pending entry and no shell, "Starting side chat…" is visible, the reveal button text is "observation space", the composer textbox is focused, and `screen.router?.state.location.pathname` still equals `LESSON_PATH` (Ask opens the panel without a route change).
  - `"Done on a nested side chat returns to its parent without waiting for the note"`: dispatch is called with `{ environmentId, input: { threadId: "nested-1" } }`, and the surfaces become `[{ id: "side-chat:side-1", kind: "side-chat", threadId: "side-1", trail: ["side-1","nested-1"] }]`.
  - `"Done on a top-level side chat closes its tab and remembers it for reopening"`: the surfaces are `[]`, and the closed-view entry is `{ kind: "panel-tab", threadRef: LESSON_REF, surface: { id: "side-chat:side-1", kind: "side-chat", threadId: "side-1" } }`.
  - `"Discard finishes the side chat without a note"`: the input is `{ threadId: "side-1", discard: true }`.
  - `"walks the breadcrumb Lesson › observation space › Box in place"`: Box has `aria-current="page"`. Clicking observation space gives the trail `["side-1","nested-1"]`, and clicking Box drops the trail. The Lesson crumb calls `onFocusLesson` once.
  - `"shows the note a finished side chat sent to the lesson"`: the status reads `"Sent to lesson: They didn't know what an observation space is."`, and there is no Done button.
  - `"reveals a nested highlight in its parent side chat inside the panel"`: the surface shows `side-1`.
  - `"quotes a selection cited inside the panel into the side chat's draft, not the lesson's"`: the citations collected from the side chat's draft are `[[sideChatId, "history-assistant", "Done"]]`, and the lesson draft is `null`.
  - `"types into the side chat when focus is elsewhere in the panel"`: the side chat's draft is `"w"`.
  - `"answers an approval the side chat's AI is waiting on from the panel"` (R10). Mock `../chat/usePendingThreadRequests` to return one pending approval, in the shape `ChatComposer.tsx:3520-3566` consumes. The panel shows "Approve" (`ComposerPendingApprovalActions.tsx:29`), and clicking it calls the hook's approval responder with decision `"accept"`.
  - `"answers a question the side chat's AI asked from the panel"` (R10, "approvals or questions"). Mock the same hook to return one pending `user_input` request with one question (`id: "q1"`, options `"Box"` and `"Discrete"`) as `activePendingUserInput`. The panel renders `ComposerPendingUserInputPanel`; choosing `"Box"` calls the hook's `onSelectActivePendingUserInputOption` once with `("q1", "Box")`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/SideChatPanel.browser.test.tsx`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement.** React Compiler rules apply: no `useMemo` / `useCallback`, no try/finally.
  - Data:
    - `shell = useQuietThreadShell(sideChatRef)`. `detailRef` is set once the shell exists.
    - `projection` comes from `useQuietThreadProjection`, and `detail = projection?.thread.sideChat`.
    - `rows = deriveSideChatTree(useSideChatTreeShells(lessonRef), lessonRef.threadId)`.
    - `citation` is the shell's anchor plus the detail's excerpt, falling back to the pending entry's citation.
  - Crumbs come from `sideChatBreadcrumb`. Before the shell exists, use the anchor thread's crumbs plus a current crumb labelled `assistantCitationLabel(pending.citation)`.
  - `runActive = activityRun !== null && !isLatestRunSettled(activityRun, runtime)`.
  - Pending requests come from `usePendingThreadRequests({ …, activeThreadId: shell?.id ?? null, composerDraftTarget: sideChatRef, setThreadError: toast })`.
  - Optimistic rows reset on a key change (ChatView `:2144-2149`), and are filtered against the server's messages.
  - Done and Discard: `void finish({ environmentId, input: { threadId, …(discard) } })`, then `leaveSideChat(lessonRef, surface, rows)` immediately. On a failure that is not an interrupt, toast "Couldn't finish the side chat".
  - Crumbs: the lesson crumb calls `onFocusLesson()`. The others call `navigateSideChat(lessonRef, surface.id, sideChatSurfacePath(rows, id), sideChatSurfacePath(rows, current))`.
  - Reveal:
    - In the lesson, use `navigate({ ...assistantCitationNavigation(citation), replace: true })`. Only the hash changes.
    - Otherwise navigate the panel to the anchor side chat and set `citationRequest`.
  - `onOpenThread`: side chats in `rows` navigate in place, and other threads route normally.
  - Nested Ask: `askInSideChat({ lessonRef, citation, sideChatShells, topThreadId: sideChatSurfaceTopThreadId(surface), run })`. Cite goes to the composer handle.
  - Keyboard:
    - Root `onKeyDown`: PageUp and PageDown drive a page-scroll controller over `listRef` (`useTimelineFollow.ts:234-249`). A key that passes `shouldTypeToFocusComposer(…, "side-chat")` is inserted and focuses the composer.
    - `onPaste` uses `pasteTextToFocusComposer(…, "side-chat")`.
  - `autoFocus = pending?.status === "starting"`.
  - `RightPanelSurfaceContent` renders `<SideChatPanel key={\`${scopedThreadKey(threadRef)}:${surface.id}\`} …/>`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter @t3tools/web typecheck`, then `vp lint apps/web/src/components/sideChat apps/web/src/components/chat/RightPanelSurfaceContent.tsx`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/SideChatPanel.tsx apps/web/src/components/sideChat/SideChatPanel.browser.test.tsx apps/web/src/components/chat/RightPanelSurfaceContent.tsx apps/web/src/components/ChatView.tsx && git commit -m "feat(web): side-chat panel with breadcrumb, Done and Discard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 46: Wire side chats into the lesson

This covers the capability gate, reconciliation, tab labels, panel availability, auto-opening a side chat that is waiting for input, the note wait label, and throwing away an empty side chat when its tab closes.

**Files:**
- Create `apps/web/src/components/sideChat/useLessonSideChats.ts`.
- Test: create `useLessonSideChats.browser.test.tsx`, with the mocks of Task 45.
- Modify `apps/web/src/components/ChatView.tsx`:
  - After `:1186`: the hook call.
  - `:3125`: `rightPanelAvailable`.
  - `:3265-3270`: the Ask props and `sideChatWaitLabel` on `ThreadTimeline`.
  - `:3832-3880`: `sideChatLabelsById`.
- Modify `apps/web/src/hooks/useRightPanelSurfaceClose.ts:30-67` (`releaseSurfaceResources`). The decision is `shouldFinishSideChatOnClose`, tested in Task 37. The hook only wires it, so it gets no test of its own (AGENTS: no wiring tests).

**Interfaces:**
- Consumes: Tasks 35, 36, 37 (`sideChatAwaitingInput`, `topSideChatId`, `lessonSideChatWaitLabel`, `shouldFinishSideChatOnClose`), 38 and 44, `isSideChatThread`, `readThreadShell` and `useStableCallback`.
- Produces:
  ```ts
  export function useLessonSideChats(input: {
    readonly lessonRef: ScopedThreadRef | null; // null for drafts and for a route that is itself a side chat
    readonly supported: boolean;                // capabilities.sideChats === true
    readonly bootstrapComplete: boolean;
    readonly activityRunStatus: OrchestrationV2Run["status"] | null;
  }): {
    readonly shells: ReadonlyArray<EnvironmentThreadShell>;
    readonly labelsById: ReadonlyMap<string, string>;
    readonly askPending: boolean;
    readonly noteWaitLabel: "Adding side-chat note…" | null;
    readonly onAskInSideChat: ((citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean) | undefined;
  };
  ```

- [ ] **Step 1: Write the failing tests.**
  - `"drops tabs of side chats that are gone but keeps one that is still starting"`: the surface ids become `["side-chat:side-1","side-chat:side-new"]`, Ask is offered, and the labels are `[["side-1","observation space"]]`.
  - `"opens the side chat whose AI is waiting for an answer"`: with nested-1 `hasPendingApprovals: true`, the surfaces become `[{ id: "side-chat:side-1", kind: "side-chat", threadId: "nested-1" }]`.
  - `"offers no Ask and drops side-chat and Map tabs without the side-chats capability"`: the surfaces become `["diff"]`, and Ask is hidden.
  - `"says it is adding a side-chat note while the lesson's run waits for one"`: with `activityRunStatus: "starting"` and a direct child with `noteStatus: "generating"`, `noteWaitLabel` is `"Adding side-chat note…"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/useLessonSideChats.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `shells = useSideChatTreeShells(supported ? lessonRef : null)`, and `run = useOrchestrationCommand(threadEnvironment.openSideChat, { reportFailure: false })`.
  - Reconcile effect (`[bootstrapComplete, lessonRef, shells, supported]`):
    - `prune` the pending entries.
    - `live` is the shell ids plus the pending ids.
    - `reconcileSideChatSurfaces(lessonRef, live, supported)`.
  - Awaiting effect: `revealSideChat(lessonRef, awaitingId, true)`.
  - In ChatView:
    - `supportsSideChats = serverConfig?.environment.capabilities.sideChats === true`.
    - `lessonRef` is the active ref when the route is a server thread and `!isSideChatThread(activeThreadShell)`.
    - `rightPanelAvailable: activeProject !== null || hasSideChatSurfaces(rightPanelState.surfaces)`.
    - Spread `onAskInSideChat` and `askInSideChatPending` in the non-paint-only spread, and pass `sideChatWaitLabel={lessonSideChats.noteWaitLabel}`.
    - Pass `sideChatLabelsById={lessonSideChats.labelsById}` to `ChatRightPanel`.
  - `releaseSurfaceResources`: for a `side-chat` surface whose shell passes `shouldFinishSideChatOnClose`, call `void finishSideChat({ environmentId, input: { threadId: shell.id } })`, with `finishSideChat = useOrchestrationCommand(threadEnvironment.finishSideChat, { reportFailure: false })`. The server then deletes the empty side chat (Task 25).
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter @t3tools/web typecheck`, then `vp lint` on the three modified files. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/useLessonSideChats.ts apps/web/src/components/sideChat/useLessonSideChats.browser.test.tsx apps/web/src/components/ChatView.tsx apps/web/src/hooks/useRightPanelSurfaceClose.ts && git commit -m "feat(web): ask in side chat from the lesson and keep its tabs in sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Phase 5: Web, the Map, marks, palette, keybinding and housekeeping

### Task 47: Side-chat map layout (`layoutSideChatTree`)

**Files:**
- Create `apps/web/src/lib/sideChatTreeLayout.ts`.
- Test: create `sideChatTreeLayout.test.ts`. Mirror `lib/turnDiffTree.test.ts`, which tests a pure function.

**Interfaces:**
- Consumes: `SideChatTreeRow` (Task 5). Rows come root first, in preorder.
- Produces:
  ```ts
  export interface SideChatTreeLayoutOptions { readonly nodeWidth: number; readonly nodeHeight: number; readonly gapX: number; readonly gapY: number }
  export interface SideChatTreeLayoutNode { readonly threadId: ThreadId; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  export interface SideChatTreeLayoutEdge { readonly from: ThreadId; readonly to: ThreadId; readonly path: string }
  export interface SideChatTreeLayout { readonly nodes: Array<SideChatTreeLayoutNode>; readonly edges: Array<SideChatTreeLayoutEdge>; readonly width: number; readonly height: number }
  export function layoutSideChatTree(rows: ReadonlyArray<SideChatTreeRow>, opts: SideChatTreeLayoutOptions): SideChatTreeLayout;
  ```

- [ ] **Step 1: Write the failing tests.** Use `OPTS = { nodeWidth: 112, nodeHeight: 26, gapX: 8, gapY: 48 }` and `box(id, x, y) = { threadId: id, x, y, width: 112, height: 26 }`.
  - `"gives leaves consecutive slots, centres parents and stacks depths"`. The rows are `lesson; a; a1 (under a); b; b1 (under b); c`.
    - Nodes: `[box("lesson",120,0), box("a",0,74), box("a1",0,148), box("b",120,74), box("b1",120,148), box("c",240,74)]`.
    - Edges: `{ from: "lesson", to: "a", path: "M 176 26 C 176 50, 56 50, 56 74" }`, `{ a → a1, "M 56 100 C 56 124, 56 124, 56 148" }`, `{ lesson → b, "M 176 26 C 176 50, 176 50, 176 74" }`, `{ b → b1, "M 176 100 C 176 124, 176 124, 176 148" }` and `{ lesson → c, "M 176 26 C 176 50, 296 50, 296 74" }`.
    - Width and height are `[352, 174]`.
  - `"centres a parent between its first and last child, not on their mean"`. The rows are `lesson; a; a1; a2; b; c`. The x values are `[lesson 210, a 60, a1 0, a2 120, b 240, c 360]`, and the width is 472.
  - `"lays out a lone lesson, an empty tree and a row whose parent is missing"`:
    - A lone lesson gives `{ nodes: [box("lesson",0,0)], edges: [], width: 112, height: 26 }`.
    - `[]` gives zeros.
    - A stray row whose parent is `gone` gives `box("stray",120,74)` and no edge.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/lib/sideChatTreeLayout.test.ts`. Expected: FAIL, because the import cannot be resolved.
- [ ] **Step 3: Implement the tidy tree.** It has no dependencies and touches no DOM.
  - Leaves (rows with no child in `rows`) take consecutive slots of `nodeWidth + gapX`, in preorder.
  - Walking the rows backwards, each parent sits at the midpoint of its first and last child.
  - `y = depth * (nodeHeight + gapY)`.
  - Each edge is `` `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}` ``, from the parent's bottom centre to the child's top centre.
  - A row whose parent is not in `rows` is laid out as a root with no edge.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file and `vp lint` on both files. Expected: 3 passed.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/sideChatTreeLayout.ts apps/web/src/lib/sideChatTreeLayout.test.ts && git commit -m "feat(web): lay out the side-chat map as a tidy tree" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 48: Map keyboard, status and fit logic

**Files:**
- Create `apps/web/src/components/sideChat/SideChatMap.logic.ts`.
- Test: create `SideChatMap.logic.test.ts`. Mirror `components/RightPanelTabs.test.tsx`.

**Interfaces:**
- Produces:
  - `SIDE_CHAT_MAP_LAYOUT: SideChatTreeLayoutOptions = { nodeWidth: 112, nodeHeight: 26, gapX: 8, gapY: 48 }`
  - `resolveSideChatMapKeyTarget(rows, fromThreadId: ThreadId, key: string): ThreadId | null`
    - Up goes to the parent, when that row exists.
    - Down goes to the first child.
    - Left and Right go to the previous and next sibling, without wrapping.
    - Anything else returns `null`.
  - `sideChatMapNodeStatus(row): "in_progress" | "pending" | "failed" | "completed" | null`. These are statuses `ThreadRelationshipIcon` already colours.
  - `sideChatMapNodeDescription(row): string`
  - `fitSideChatMapScale(contentWidth: number, availableWidth: number): number`

- [ ] **Step 1: Write the failing tests.** Use the Task 47 tree.
  - From `a`: Up gives lesson, Down gives a1, Right gives b, and Left gives null.
  - From `c`: Left gives b and Right gives null.
  - From the lesson: Up gives null, Down gives a, and Right gives null.
  - From `a1`: Right and Down give null.
  - Enter gives null, and an unknown thread gives null.

  | Row | Status | Description |
  |---|---|---|
  | lesson | `null` | `"Lesson"` |
  | open | `in_progress` | `"Open"` |
  | done / generating | `pending` | `"Done, writing note"` |
  | done / failed | `failed` | `"Done, couldn't write the note"` |
  | done / ready | `completed` | `"Done, note ready"` |
  | done / none | `completed` | `"Done, no note needed"` |
  | done / null | n/a | `"Done"` |

  `fitSideChatMapScale(472, 236)` is `0.5`. `(352, 600)` is `1`. Zero for either width gives `1`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/SideChatMap.logic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `fitSideChatMapScale` returns `contentWidth <= 0 || availableWidth <= 0 ? 1 : Math.min(1, availableWidth / contentWidth)`.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/SideChatMap.logic.ts apps/web/src/components/sideChat/SideChatMap.logic.test.ts && git commit -m "feat(web): side-chat map keyboard targets, status dots and fit scale" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 49: `SideChatMap` surface, Map launcher entry and panel actions

**Files:**
- Create `apps/web/src/components/sideChat/SideChatMap.tsx`.
- Test: create `SideChatMap.browser.test.tsx`. Mirror `components/UsageToggleShortcut.browser.test.tsx`.
- Modify `components/chat/RightPanelSurfaceContent.tsx` (`case "thread-map"`).
- Modify `components/RightPanelTabs.tsx`: `:96-149` and `:165-197` (props, reasons and hints), `:308-386` and `:1030-1087` (actions), `:1450-1467`.
- Modify `components/chat/useRightPanelActions.ts:143-156,309-329`.
- Modify `components/ChatView.tsx:2389-2408,3866-3881`.

**Interfaces:**
- Consumes: Tasks 47 and 48, `useSideChatTreeShells` (Task 36), `revealSideChat` (Task 38), `deriveSideChatTree`, `ThreadRelationshipIcon`, `Toggle`, `Tooltip`, `observeResize` and `useComposerHandleContext`.
- Produces:
  - `SideChatMap(props: { readonly rows: ReadonlyArray<SideChatTreeRow>; readonly currentThreadId: ThreadId; readonly onOpenSideChat: (threadId: ThreadId) => void; readonly onFocusLesson: () => void })` and `SideChatMapSurface(props: { readonly threadRef: ScopedThreadRef })`.
  - `useRightPanelActions` returns `addThreadMapSurfaceStable: () => void`, which calls `open(ref, "thread-map")`, and `openSideChatSurfaceStable: (threadId: ThreadId) => void`, which calls `revealSideChat(ref, threadId)`.
  - `RightPanelTabsProps.onAddThreadMap?: () => void` and `threadMapAvailable?: boolean`. With `onAddThreadMap` omitted, the entry is hidden, which covers servers without side chats and `PullRequestsPage.tsx:1419`.
  - The launcher entry `{ label: "Side-chat map", icon: NetworkIcon, shortcut: "G", disabledReason: "This thread has no side chats yet." / hint "Available once this thread has side chats." }`.

- [ ] **Step 1: Write the failing test** `"walks the tree with arrow keys and opens the focused node with Enter"`. The rows are the RL tree with `currentThreadId` `b` ("reward shaping").
  - "reward shaping" has `aria-selected="true"` and `tabindex="0"`. The lesson has `aria-level="1"`, and "Box" has `aria-level="3"`.
  - Focus "reward shaping", then Up focuses the lesson, Down "observation space", Right "reward shaping", and Down "sparse reward".
  - Enter calls `onOpenSideChat` exactly once, with `"b1"`.
  - Clicking "episode" calls it with `"c"`. Clicking the lesson calls `onFocusLesson` once.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/web/src/components/sideChat/SideChatMap.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep data, layout and drawing separate. Use no `useMemo` / `useCallback`, no animation classes, and theme tokens only.
  - Structure:
    - A toolbar with `<Toggle size="xs" variant="ghost" pressed={fit} aria-label="Fit map to panel">Fit</Toggle>`.
    - Inside an `overflow-auto p-3` scroller, a sizer of `layout × scale`.
    - Inside that, `role="tree" aria-label="Side chat map"`, using `transform: scale()` only when the scale is below 1.
  - Edges are an `aria-hidden` SVG of `<path className="fill-none stroke-muted-foreground/40" strokeWidth={1.25}/>`.
  - Nodes are absolutely positioned `<button type="button" role="treeitem">`:
    - `aria-level={depth + 1}`, `aria-selected`, `aria-description={sideChatMapNodeDescription(row)}`, and roving `tabIndex`.
    - A tooltip with the full label.
    - `ThreadRelationshipIcon` (`BookOpenIcon` for the lesson, `MessageCircleIcon` otherwise), then a truncated label.
    - The current node adds `border-primary ring-1 ring-primary`, and the lesson is `font-semibold`.
  - Keys: the tree's `onKeyDown` uses `resolveSideChatMapKeyTarget` to move focus. Enter is the focused button's native click.
  - On mount and on a current-node change, `scrollIntoView({ block: "nearest", inline: "center" })`.
  - Fit width comes from `observeResize` on the scroller, minus 24.
  - `SideChatMapSurface`:
    - `lessonRef` is the route shell's `sideChat?.lessonThreadId ?? threadRef.threadId`.
    - The current node is the active surface when it is a side chat, else the first side-chat surface, else the lesson.
    - Opening a side chat calls `revealSideChat`. The lesson node focuses the composer on its own route, and navigates to the lesson otherwise.
    - With `rows.length <= 1`, it shows `"No side chats yet. Select text in a reply and choose Ask in side chat."`.
  - ChatView passes `onAddThreadMap` only when `capabilities.sideChats` is set, with `threadMapAvailable={lessonSideChats.shells.length > 1}` (Task 46).
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/web/src/components/sideChat/SideChatMap.browser.test.tsx apps/web/src/components/RightPanelTabs.test.tsx`, then `vp run --filter @t3tools/web typecheck`, then `vp lint` on the modified files. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/SideChatMap.tsx apps/web/src/components/sideChat/SideChatMap.browser.test.tsx apps/web/src/components/chat/RightPanelSurfaceContent.tsx apps/web/src/components/RightPanelTabs.tsx apps/web/src/components/chat/useRightPanelActions.ts apps/web/src/components/ChatView.tsx && git commit -m "feat(web): side-chat map tab in the right panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 50: Resolve a side-chat anchor without its quote

Shells carry the anchor's offsets and 32-unit context, but not the excerpt, so `findAssistantCitationText`, which needs the quote, cannot place marks.

**Files:**
- Modify `apps/web/src/lib/assistantTextSelection.ts:272-294`. Extract the range-building tail of `resolveAssistantCitationRange` into a private `rangeForMatch`.
- Test: `apps/web/src/lib/assistantTextSelection.test.ts`. Add a new describe after `:415`.

**Interfaces:**
- Produces:
  - `type AssistantTextAnchor = Pick<AssistantTextSelector, "start" | "end" | "prefix" | "suffix">`
  - `findAssistantAnchorText(text: string, anchor: AssistantTextAnchor): { start: number; end: number } | null`
  - `resolveAssistantAnchorRange(root: HTMLElement, anchor: AssistantTextAnchor): Range | null`

- [ ] **Step 1: Write the failing tests.** Build `anchor` with `createAssistantTextSelector` on "An observation space is what the agent can see.".
  - `"finds an anchor by its context after earlier text shifts it"`: the result is `{ start: 3, end: 20 }`, and `{ start: 16, end: 33 }` after the text is prefixed with "Recap first. ".
  - `"does not guess when the context repeats or no longer matches"`: `null` for the text twice, and `null` for "An action space…".
  - `"anchors a whole-message selection only while the message keeps its length"`: for `text = "observation space"` and the selector of the whole message (`{ start: 0, end: 17, prefix: "", suffix: "" }`), `findAssistantAnchorText(text, anchor)` is `{ start: 0, end: 17 }`, and `findAssistantAnchorText(\`${text}!\`, anchor)` (one character longer) is `null`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/lib/assistantTextSelection.test.ts -t "findAssistantAnchorText"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The length is `end − start`. Reject non-integers and non-positive lengths.
  - Normalize whitespace, and collect candidates from the prefix occurrences, else the suffix occurrences, else a whole-text match.
  - Keep the candidates whose prefix and suffix match on both sides. Exactly one match resolves; a tie resolves to nothing, as for citations.
  - `resolveAssistantAnchorRange` is `resolveAssistantCitationRange` with this matcher.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the whole test file. Expected: PASS, with the existing citation tests unchanged.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/assistantTextSelection.ts apps/web/src/lib/assistantTextSelection.test.ts && git commit -m "feat(web): locate side-chat anchors from offsets and context" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 51: Marks in assistant rows (`SideChatMarks`)

**Files:**
- Modify `apps/web/src/state/entities.ts`: the marks selector and atom.
- Create `apps/web/src/components/sideChat/SideChatMarks.tsx`.
- Modify `components/chat/TimelineAssistantRows.tsx:26-74`, `timelineRowContext.ts:23-67`, `MessagesTimeline.tsx:176-330,897-934` and `components/sideChat/SideChatTimeline.tsx` / `SideChatPanel.tsx` (the `onOpenSideChat` prop).
- Modify `ChatView.tsx:3265-3270` and `index.css:642-652`, inside `@layer base` after `::highlight(t3-assistant-citation-comment)`.
- Test: `apps/web/src/state/entities.sideChatShells.test.ts`, and create `SideChatMarks.browser.test.tsx`. Mirror `chat/AssistantCitationChip.browser.test.tsx`.

**Interfaces:**
- Consumes: `makeSideChatThreadFixture` (Task 36), `resolveAssistantAnchorRange` (Task 50), `openSideChatSurfaceStable` (Task 49), `navigateSideChat` and `sideChatSurfacePath` (Tasks 35 and 37), and `observeResize`.
- Produces:
  ```ts
  // entities.ts
  export interface SideChatMark { readonly threadId: ThreadId; readonly label: string; readonly state: "open" | "done"; readonly anchor: OrchestrationV2SideChatAnchor }
  export function selectSideChatMarks(anchorRef: ScopedThreadRef, messageId: MessageId, shells: ReadonlyArray<EnvironmentThreadShell>): ReadonlyArray<SideChatMark>;
  export function sideChatMarksEqual(left: ReadonlyArray<SideChatMark>, right: ReadonlyArray<SideChatMark>): boolean;
  export function useSideChatMarks(anchorRef: ScopedThreadRef | null, messageId: MessageId): ReadonlyArray<SideChatMark>;
  // SideChatMarks.tsx
  export const SIDE_CHAT_MARK_HIGHLIGHT_NAME = "t3-side-chat-mark";
  export interface SideChatMarksLayout { readonly tags: ReadonlyArray<{ threadId: ThreadId; label: string; state: "open" | "done"; top: number; left: number }>; readonly unresolved: ReadonlyArray<SideChatMark> }
  export function observeSideChatMarks(input: { readonly layer: HTMLElement; readonly source: HTMLElement; readonly marks: ReadonlyArray<SideChatMark>; readonly onLayout: (layout: SideChatMarksLayout) => void }): () => void;
  export function SideChatMarks(props: { readonly messageId: MessageId; readonly marks: ReadonlyArray<SideChatMark>; readonly onOpen: (threadId: ThreadId) => void }): React.ReactElement;
  // MessagesTimelineProps / ThreadTimeline / SideChatTimeline
  onOpenSideChat?: (threadId: ThreadId) => void;
  // TimelineRowSharedState
  onOpenSideChat: ((threadId: ThreadId) => void) | undefined;
  ```

- [ ] **Step 1: Write the failing tests.**
  - Selector, `"lists the side chats anchored in one message, oldest first"`: for the lesson and `assistant-1`, `[earlier done, first open]`. For `first` as the anchor thread, `["nested"]`.
  - Selector, `"compares marks by what a mark draws"`: copies compare equal, and a changed `state` or `anchor.start` compares unequal.
  - Browser, `"paints anchored side chats, opens them from their tag or the fallback chip, and survives a re-render"`. One resolvable mark and one with prefix `zzz` / suffix `qqq`.
    - `CSS.highlights.get(SIDE_CHAT_MARK_HIGHLIGHT_NAME)` ranges are `["observation space"]`.
    - Clicking `"Open side chat “observation space”"` calls `onOpen("side-1")`.
    - Clicking `"↳ 1 side chat"` calls `onOpen("side-2")`.
    - After a rerender with split text nodes the ranges are still `["observation space"]`.
    - After unmount the registry has no `t3-side-chat-mark`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/state/entities.sideChatShells.test.ts apps/web/src/components/sideChat/SideChatMarks.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Selector: keep live shells in the ref's environment where `anchor.threadId === anchorRef.threadId` and `anchor.messageId === messageId`, sorted by `createdAt`. The atom over `quietThreadShellsAtom` is keyed `` `${threadKey(ref)}\u001f${messageId}` `` and keeps its previous array while `sideChatMarksEqual` holds.
  - `observeSideChatMarks`:
    - Resolve each anchor, add the ranges to a shared `Highlight` under the name, and place a tag at the end of each mark's last client rect, relative to the layer.
    - A `MutationObserver` on the source and `observeResize` on the layer repaint in one rAF.
    - Cleanup removes this row's ranges, and deletes the registry entry once it is empty. This is the lifecycle of `AssistantCitationSource.tsx:20-84`.
  - `SideChatMarks`:
    - An absolute `pointer-events-none` layer holds `pointer-events-auto` tag buttons (`size-4`, `MessageCircleIcon`) with a tooltip. Open tags are `border-primary text-primary`, done tags `text-muted-foreground`.
    - When marks are unresolved, a `<Button size="micro" variant="ghost-muted">` reads `↳ N side chat(s)`. One side chat opens directly, several open a `Menu`.
  - CSS: `::highlight(t3-side-chat-mark)` gets a dotted 1.5px underline in `color-mix(in oklab, var(--primary) 70%, transparent)` and a background of `color-mix(in oklab, var(--primary) 8%, transparent)`.
  - `AssistantTimelineRow` mounts `SideChatMarks` after the `data-thread-find-text` div, inside the `relative` wrapper (`:32`), when `ctx.onOpenSideChat` is set, marks exist, and the message is not streaming. Tags never enter find, copy or selection.
  - ChatView adds `onOpenSideChat: openSideChatSurfaceStable` to the non-paint-only spread, so held timelines show no marks.
  - `SideChatPanel` passes in-panel navigation to `SideChatTimeline` as `onOpenSideChat`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests and `MessagesTimeline.browser.test.tsx`, then `vp run --filter @t3tools/web typecheck`, then `vp lint` on the modified files. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/state/entities.ts apps/web/src/state/entities.sideChatShells.test.ts apps/web/src/components/sideChat/SideChatMarks.tsx apps/web/src/components/sideChat/SideChatMarks.browser.test.tsx apps/web/src/components/sideChat/SideChatTimeline.tsx apps/web/src/components/sideChat/SideChatPanel.tsx apps/web/src/components/chat/TimelineAssistantRows.tsx apps/web/src/components/chat/timelineRowContext.ts apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/ChatView.tsx apps/web/src/index.css && git commit -m "feat(web): mark side-chat highlights in the lesson" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 52: Side-chat navigation targets and command palette entries

**Files:**
- Modify `apps/web/src/components/sideChat/sideChatNavigation.ts` (Task 38).
- Modify `components/CommandPalette.tsx:514-519`, and add after `:1344`.
- Modify `CommandPaletteThreadItems.tsx:141-146` and `CommandPalette.logic.ts:377` (widen `runThread` to `Pick<SidebarThreadSummary, "environmentId" | "id" | "sideChat">`).
- Test: create `sideChatNavigation.test.ts`. Mirror `components/Sidebar.logic.test.ts`.

**Interfaces:**
- Consumes: `revealSideChat` and `leaveSideChat` (Task 38), and `threadEnvironment.finishSideChat` through `useAtomCommand`.
- Produces:
  ```ts
  export interface ThreadOpenTarget { readonly routeThreadId: ThreadId; readonly sideChatThreadId: ThreadId | null }
  export function resolveThreadOpenTarget(thread: { readonly id: ThreadId; readonly sideChat?: { readonly lessonThreadId: ThreadId } | null | undefined }): ThreadOpenTarget;
  export function sideChatLessonRef(thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId; readonly sideChat?: { readonly lessonThreadId: ThreadId } | null | undefined }): ScopedThreadRef;
  export function openThreadTarget(input: { readonly navigate: ReturnType<typeof useNavigate>; readonly environmentId: EnvironmentId; readonly target: ThreadOpenTarget; readonly currentThreadRef?: ScopedThreadRef | null }): Promise<void>; // revealSideChat first, then navigate unless already on the lesson
  export function isSideChatNotificationQuiet(input: { readonly environmentId: EnvironmentId; readonly thread: { readonly sideChat?: { readonly lessonThreadId: ThreadId } | null }; readonly activeEnvironmentId: string | undefined; readonly activeThreadId: string | undefined; readonly documentActive: boolean }): boolean;
  export function resolveFinishableSideChat(input: { readonly surfaces: ReadonlyArray<RightPanelSurface>; readonly activeSurfaceId: string | null; readonly shells: ReadonlyArray<Pick<EnvironmentThreadShell, "environmentId" | "id" | "sideChat">>; readonly environmentId: EnvironmentId }): { readonly threadId: ThreadId; readonly label: string; readonly surface: SideChatSurface } | null; // the active side-chat surface, when its side chat is open
  ```
  - The palette action `"action:open-side-chat-map"`, titled "Open side-chat map", runs `open(lessonRef, "thread-map")` and navigates to the lesson when needed. Its search terms are `["side chat", "map", "tree", "diagram", "detours"]`.
  - The palette action `"action:finish-side-chat"`, titled "Finish side chat (Done)" with the label as its description, runs `leaveSideChat(lessonRef, surface, rows)`, then `finishSideChat`. It throws the squashed failure unless interrupted.
  - Both actions appear only with `capabilities.sideChats`.
  - Palette thread search opens a side chat as its lesson's route plus the panel.

- [ ] **Step 1: Write the failing tests.**
  - `"opens a side chat on its lesson's route and an ordinary thread on its own"`:
    - `resolveThreadOpenTarget(lesson)` is `{ routeThreadId: "lesson", sideChatThreadId: null }`.
    - For `nested` it is `{ routeThreadId: "lesson", sideChatThreadId: "nested" }`.
    - `sideChatLessonRef(nested).threadId` is `"lesson"`.
  - `"keeps side-chat notifications quiet only while their lesson is on screen"`: `true` on screen. `false` when the document is inactive, when another thread is active, or for a non-side-chat.
  - `"finishes the open side chat the panel shows"`: an active `side-chat:side` showing `nested` gives `{ threadId: "nested", label: "Box", surface }`. A done side chat gives `null`. An inactive side-chat surface gives `null`, and no surfaces gives `null`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/sideChatNavigation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the palette entries. Rows for Done come from `deriveSideChatTree(readSideChatTreeShells(lessonRef), lessonRef.threadId)`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `vp test run apps/web/src/components/sideChat/sideChatNavigation.test.ts apps/web/src/components/CommandPalette.logic.test.ts && vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/sideChat/sideChatNavigation.ts apps/web/src/components/sideChat/sideChatNavigation.test.ts apps/web/src/components/CommandPalette.tsx apps/web/src/components/CommandPaletteThreadItems.tsx apps/web/src/components/CommandPalette.logic.ts && git commit -m "feat(web): side-chat map, Done and search in the command palette" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 53: `sideChat.askSelection` keybinding and toolbar selection registry

The default is `mod+alt+s` with `when: "!terminalFocus"`. Every `mod+shift+<letter>` that fits is taken or unsafe: `l` is `composer.previousWorktree`, `s` is `thread.settle`, `a` is `composer.mode`, and `ctrl+shift+i` opens DevTools (`DesktopApplicationMenu.ts:254`). AltGr+S is already refused (`packages/shared/src/keybindings.ts:129-134`).

**Files:**
- Modify `packages/contracts/src/keybindings.ts:59-116`: append to `STATIC_KEYBINDING_COMMANDS`.
- Modify `packages/shared/src/keybindings.ts:207`.
- Modify `apps/server/src/keybindings.ts:461-575` (`syncDefaultKeybindingsOnStartup`): both disk writes (the fresh-file `writeConfigAtomically(DEFAULT_KEYBINDINGS)` at `:469` and the `missingDefaults` backfill) skip rules whose command starts with `sideChat.`.
- Modify `apps/web/src/components/settings/KeybindingsSettings.logic.ts:212,245-289,353-361,363-381`: `buildKeybindingRows` and `buildKeybindingCommandOptions` take `sideChats: boolean` and drop `sideChat.*` commands when it is `false`. `KeybindingsSettings.tsx` passes the primary environment's `capabilities.sideChats === true`, so the row shows only against a fork server.
- Create `apps/web/src/components/sideChat/sideChatSelectionRegistry.ts`.
- Modify `components/chat/AssistantSelectionToolbar.tsx` and `components/ChatView.tsx:2714-2745`.
- Tests: create `sideChatSelectionRegistry.test.ts` (mirror `lib/terminalCloseConfirm.test.ts`). Extend `apps/web/src/keybindings.test.ts`, `settings/KeybindingsSettings.logic.test.ts` and `apps/server/src/keybindings.test.ts` (next to `"upserts missing default keybindings on startup without overriding existing command rules"`, `:210`).

**Interfaces:**
- Consumes: the Ask handler and blocked state of `AssistantSelectionToolbar` (Task 33).
- Produces:
  - The `KeybindingCommand` literal `"sideChat.askSelection"`, with the default `{ key: "mod+alt+s", command: "sideChat.askSelection", when: "!terminalFocus" }`. The default lives in `DEFAULT_KEYBINDINGS`, so `mergeWithDefaultKeybindings` applies it in memory, but the server's startup sync never writes it to disk (Global Constraints).
  - `commandLabel` returns `"Side Chat: Ask About Selection"`, and the command is grouped under `threads` (prefix `"sideChat"`).
  - `interface SideChatSelectionOwner { readonly contains: (node: Node) => boolean; readonly ask: () => boolean }`
  - `registerSideChatSelectionOwner(owner): () => void`
  - `askSelectionInSideChat(selection: Pick<Selection, "anchorNode"> | null): boolean`. It asks the most recently registered owner that contains the anchor node, and returns `false` otherwise, which lets the chord through.

- [ ] **Step 1: Write the failing tests.**
  - Registry, `"asks the toolbar whose viewport holds the selection and lets the key through otherwise"`: the panel owner is asked once and the lesson owner not at all. An unknown node or `null` gives `false`, and after disposal the result is `false`.
  - `keybindings.test.ts`, `"asks about the selection with mod+alt+s outside the terminal"`:
    - On Mac, `{ key: "ß", code: "KeyS", metaKey, altKey }` gives `"sideChat.askSelection"`.
    - On Linux, `ctrl+alt+s` gives it, and gives `null` with `terminalFocus: true`.
  - `KeybindingsSettings.logic.test.ts`, `"labels the side-chat shortcut, files it under Threads and keeps its default chord free"`: the row key is `"mod+alt+s"`, the conflicts are `[]`, the label matches, and the group is `"threads"`. Without the `sideChats` capability the rows contain no `"sideChat.askSelection"` command.
  - `apps/server/src/keybindings.test.ts`, `"startup sync never writes sideChat.askSelection into keybindings.json"`, mirroring the `:210` test:
    - With an existing `keybindings.json` holding one custom rule, run `syncDefaultKeybindingsOnStartup`. The file on disk contains other missing defaults (for example `sidebar.toggle`) but no `"sideChat.askSelection"`, and the resolved config still includes `{ command: "sideChat.askSelection" }` with the `mod+alt+s` shortcut.
    - With no `keybindings.json`, the file the sync creates contains no `"sideChat.askSelection"` either.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/sideChat/sideChatSelectionRegistry.test.ts apps/web/src/keybindings.test.ts apps/web/src/components/settings/KeybindingsSettings.logic.test.ts apps/server/src/keybindings.test.ts -t "side"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The toolbar registers `{ contains: (node) => viewport.contains(node), ask: () => askFromShortcut() }` in an effect, while a selection exists and Ask is not blocked. `askFromShortcut = useEffectEvent(<the Ask handler>)`, declared above the early return.
  - ChatView adds the command `"sideChat.askSelection": () => askSelectionInSideChat(window.getSelection())`.
  - Server: a module constant `DISK_SYNCED_DEFAULT_KEYBINDINGS = DEFAULT_KEYBINDINGS.filter((rule) => !rule.command.startsWith("sideChat."))` replaces `DEFAULT_KEYBINDINGS` in the two writes of `syncDefaultKeybindingsOnStartup` (the fresh file and the `missingDefaults` loop), with the comment "an official server rejects unknown commands in keybindings.json and then stops syncing defaults; fork-only defaults apply through mergeWithDefaultKeybindings instead". `loadConfigStateFromDisk` keeps merging the full `DEFAULT_KEYBINDINGS`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests above (the whole `apps/server/src/keybindings.test.ts` file included), then `vp run --filter @t3tools/contracts typecheck && vp run --filter @t3tools/shared typecheck && vp run --filter t3 typecheck && vp run --filter @t3tools/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/contracts/src/keybindings.ts packages/shared/src/keybindings.ts apps/server/src/keybindings.ts apps/server/src/keybindings.test.ts apps/web/src/components/settings/KeybindingsSettings.logic.ts apps/web/src/components/settings/KeybindingsSettings.logic.test.ts apps/web/src/components/settings/KeybindingsSettings.tsx apps/web/src/keybindings.test.ts apps/web/src/components/sideChat/sideChatSelectionRegistry.ts apps/web/src/components/sideChat/sideChatSelectionRegistry.test.ts apps/web/src/components/chat/AssistantSelectionToolbar.tsx apps/web/src/components/ChatView.tsx && git commit -m "feat(web): ask about a selection in a side chat with mod+alt+s" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 54: Client-runtime housekeeping (navigation, lesson input banner, merge-back)

**Files:**
- Modify `packages/client-runtime/src/state/threadShell.ts`: `:9`, `:48-62`, `:86-94`, `:284-308` and `:411`.
- Modify `packages/client-runtime/src/state/threadRelationships.ts:36-43`.
- Test: `threadShell.test.ts` (after `:216`) and `threadRelationships.test.ts` (after `:280`).

**Interfaces:**
- Produces:
  - `navigationThreadShellsAtom` omits side chats.
  - `childThreadInputsAtom(lessonRef)` includes side chats with a live approval or question. Nested ones come through their parent side chat.
  - `childThreadInputsTitle(children: ReadonlyArray<Pick<EnvironmentThreadShell, "hasPendingApprovals" | "sideChat">>): string` uses "Side chat(s)" when every child is a side chat, "Subagent(s)" when none is, and "Thread(s)" otherwise. The format is unchanged.
  - `resolveMergeBackTargetThreadId` returns `null` for side chats. Web (`ThreadRelationshipsControl.tsx:289`) and mobile (`ThreadRouteScreen.tsx:334`) then hide Merge back.
  - `pendingSubagentRequestsByThread` stays unchanged, so the sidebar status never borrows a side chat's request.

- [ ] **Step 1: Write the failing tests.**
  - `"leaves side chats out of navigation and raises their questions on the lesson's banner only"`:
    - Navigation is `[lesson]`.
    - The inputs are `[side-chat]`, titled `"Side chat needs approval"`, and the lesson's `pendingSubagentRequest` is null.
    - After moving the request to `nested` as `user_input`, the inputs are `[nested]`, titled `"Side chat needs input"`.
    - A mixed pair is titled `"2 threads need input"`.
  - `"offers no merge-back target for a side chat"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run packages/client-runtime/src/state/threadShell.test.ts packages/client-runtime/src/state/threadRelationships.test.ts -t "side chat"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Split `subagentRequest` into `liveChildRequest` (kind, `auth_refresh` and live-run checks) and the subagent lineage check.
  - The child inputs index children that are subagents or side chats. They push `subagentRequest(child) ?? (isSideChatThread(child) ? liveChildRequest(child) : null)`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests, then `vp run --filter @t3tools/client-runtime typecheck && vp run --filter @t3tools/mobile typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/client-runtime/src/state/threadShell.ts packages/client-runtime/src/state/threadShell.test.ts packages/client-runtime/src/state/threadRelationships.ts packages/client-runtime/src/state/threadRelationships.test.ts && git commit -m "feat(client-runtime): keep side chats out of navigation and raise their questions on the lesson" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 55: Web housekeeping (sidebar, Lineage, banner, notifications) and the per-site record

**Files:**
- Modify `components/Sidebar.logic.ts:10,515-552`, `state/entities.ts:399-428` (`selectThreadRelationshipShells`), `chat/ThreadRelationshipsControl.tsx:282-285`, `chat/useThreadLifecycle.tsx:444-451` and `ThreadNotificationCoordinator.tsx:162-236`.
- Test: `Sidebar.logic.test.ts` (`describe("sidebar thread lineage helpers")`) and `state/entities.relationshipShells.test.ts`.

**Interfaces:**
- Consumes: `makeSideChatThreadFixture` (Task 36), `resolveThreadOpenTarget`, `openThreadTarget` and `isSideChatNotificationQuiet` (Task 52), and Task 54.
- Produces:
  - `isSidebarHiddenThread(thread: Pick<SidebarThreadSummary, "lineage" | "sideChat">)`, renamed from `isSidebarSubagentThread`.
  - `filterSidebarV2VisibleThreads` hides side chats, and `resolveSidebarRowThreadId` maps a side chat at any depth to its lesson's row.
  - `selectThreadRelationshipShells` drops side chats other than the current thread.
  - The banner's `onOpenThread` opens a side chat in the lesson's panel through `openThreadTarget`.
  - The notification coordinator skips side chats while `isSideChatNotificationQuiet`. Its toast "Open" and desktop click go through `openThreadTarget`.

Client-side per-site record, for the PR body (Task 58):

| Site | Decision |
|---|---|
| `Sidebar.logic.ts:515-552` | hide; `resolveSidebarRowThreadId` → lesson (this task) |
| `client-runtime threadShell.ts:411` (navigation) | hide (Task 54) |
| `threadShell.ts:284-308` (child inputs) | bubble to the lesson banner, which opens the panel (Task 54, this task) |
| `threadShell.ts:48-84` (`pendingSubagentRequestsByThread`) | no change: the lesson's sidebar status stays its own |
| `threadRelationships.ts:39` (merge-back target) | `null` for side chats (Task 54) |
| `threadRelationships.ts:92` (edge kind) | no change: web drops side chats before building the graph |
| `ThreadRelationshipsControl.tsx:236,282-305,313,437` | hide side chats from Lineage (this task) |
| `ThreadNotificationCoordinator.tsx:131` | quiet while the lesson is on screen; "Open" → lesson + panel (this task) |
| `ChatView.tsx:756-757,776-779`; `client-runtime models.ts:282-285`; `subagentRuntime.ts:341,372`; `threadExecution.ts:127`; mobile `ThreadDetailScreen.tsx:535`, `useLinkedPullRequestActions.ts:48`, `McpAppFullscreenScreen.tsx:50` | no change: side chats are app-created forks and render only in the panel |
| `apps/mobile/src/features/threads/threadListV2.ts:231,619` | hide, in this fork's mobile build (Task 56) |
| turn-item `type === "subagent"` sites | not lineage; no change |

- [ ] **Step 1: Write the failing tests.**
  - `"hides side chats and maps an open one, however nested, to its lesson's row"`: the visible threads are `["lesson","fork"]`. `resolveSidebarRowThreadId` gives the lesson for both `side` and `nested`, and the fork for the fork.
  - `"leaves side chats out of the lineage but keeps a side chat that is the current thread"`: the results are `["current","fork"]`, and `["current","lesson"]` when the current thread is a side chat.
- [ ] **Step 2: Run them and confirm they fail.** Run `vp test run apps/web/src/components/Sidebar.logic.test.ts apps/web/src/state/entities.relationshipShells.test.ts -t "side chat"`. Expected: FAIL.
- [ ] **Step 3: Implement** the decisions above. In the notification coordinator, the quiet check comes after `if (!kind) continue;` (`:162`), with `documentActive: document.visibilityState === "visible" && document.hasFocus()`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the tests and `ThreadNotificationCoordinator.badge.browser.test.tsx`, then `vp run --filter @t3tools/web typecheck`, then `vp lint` on the modified files. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/components/Sidebar.logic.ts apps/web/src/components/Sidebar.logic.test.ts apps/web/src/state/entities.ts apps/web/src/state/entities.relationshipShells.test.ts apps/web/src/components/chat/ThreadRelationshipsControl.tsx apps/web/src/components/chat/useThreadLifecycle.tsx apps/web/src/components/ThreadNotificationCoordinator.tsx && git commit -m "feat(web): keep side chats out of thread lists and route their alerts to the lesson panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 56: Mobile thread list hides side chats (this fork's build)

**Files:**
- Modify `apps/mobile/src/features/threads/threadListV2.ts:230-232,618-619`.
- Test: `threadListV2.test.ts`, in `describe("getThreadListV2OrderedSection")`.

**Interfaces:**
- Produces: `buildThreadListV2Items` and `getThreadListV2OrderedSection` skip side chats, as they already skip subagents. The official phone app keeps showing side chats as ordinary forks, which R11 allows.

- [ ] **Step 1: Write the failing test** `"hides side chats from the list and its ordered sections"`. Both lists are `["lesson"]`.
- [ ] **Step 2: Run it and confirm it fails.** Run `vp test run apps/mobile/src/features/threads/threadListV2.test.ts -t "hides side chats"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Both filters add `|| isSideChatThread(thread)`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run the test file, then `vp run --filter @t3tools/mobile typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/mobile/src/features/threads/threadListV2.ts apps/mobile/src/features/threads/threadListV2.test.ts && git commit -m "feat(mobile): hide side chats from the thread list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Phase 6: Verify and ship

### Task 57: Manual end-to-end run, note-quality eval and demo video

The primary agent and med run this. Task subagents never start dev servers.

**Files:** none tracked. Results go into the PR body (Task 58). Dev state lives in `$DEV/.t3` (gitignored).

**Interfaces:**
- Consumes: every task above.
- Produces:
  - The PRD §5 scenario passed on the worktree dev server.
  - A six-row note-quality table.
  - A demo video link.

- [ ] **Step 1: Start the dev server in its own process group and share it.**
  ```bash
  cd /home/quokka/.t3/projects/t3-sidechat-dev
  vp run dev --dry-run 2>&1 | grep -o 'baseDir=.*'
  (setsid vp run dev --share > .t3/dev-e2e.log 2>&1 < /dev/null & echo $! > .t3/dev-e2e.pid)
  ```
  - Expected: `baseDir=/home/quokka/.t3/projects/t3-sidechat-dev/.t3`.
  - Wait with the Bash tool's `run_in_background`: `cd /home/quokka/.t3/projects/t3-sidechat-dev && timeout 900 bash -c 'until grep -q "pairingUrl:" .t3/dev-e2e.log; do sleep 2; done' && echo shared`. Expected: `shared`; then give med the `pairingUrl` from `.t3/dev-e2e.log` for his Mac. On timeout, read `.t3/dev-e2e.log` and stop the server with Step 5.
  - If the providers are unauthenticated, stop the server with Step 5, copy (never symlink) `~/.t3/userdata/settings.json` into `/home/quokka/.t3/projects/t3-sidechat-dev/.t3/userdata/`, then repeat this step.
- [ ] **Step 2: Confirm the capability.** Run `cd /home/quokka/.t3/projects/t3-sidechat-dev && curl -fsS "$(sed -n 's/.*"origin":"\([^"]*\)".*/\1/p' .t3/userdata/server-runtime.json)/.well-known/t3/environment" | grep -o '"sideChats":true'`. Expected: `"sideChats":true`.
- [ ] **Step 3: (med) Run the PRD success scenario on the Mac and record it** with macOS screen recording.
  1. Start a lesson: "Teach me how reinforcement-learning environments work in Gymnasium. I know Python but not RL."
  2. Ask in side chat from a highlight. Then nest a side chat inside it.
  3. Press Done on one side chat. Let a lesson message auto-finish another. Leave one busy while sending in the lesson.
  4. Reload the page. Then restart the dev server (Step 5, then Step 1; pair again if the client asks) and reload again. This stands in for an app restart: med uses the dev web client here, because the official Mac app has no side-chat UI.
  5. Open the Map from the "+" launcher and from the palette, and walk it with the keyboard.
  6. Use `mod+alt+s` on a selection.
  7. Narrow the window below 980px.
  8. Switch between light and dark themes.

  Pass when all of these hold:
  - The pinned excerpt shows, and the cursor lands in the side-chat composer.
  - "Preparing context…" appears only while the summary is still being written.
  - The lesson shows no AI activity after Done.
  - The next lesson message carries a "Side-chat notes included" divider when notes exist.
  - The breadcrumb reads `Lesson › … › …`.
  - Marks survive the reload and the restart.
  - Side chats are absent from the sidebar, with the lesson row highlighted.
  - The Map scrolls to the current side chat.
  - Toolbar, Cite and Ask work in the sheet.
  - Typing and pasting inside the panel never reach the lesson composer.
- [ ] **Step 4: Note-quality eval (R5).** In the same lesson, open six side chats and press Done on each:
  - Gap A: on "observation space", ask "I don't know what an observation space is. What is it?"
  - Gap B: on "Box", ask "I've never seen Box before. What kind of thing is it?"
  - Misconception C: on "discount factor", ask "So the discount factor makes later rewards bigger, right?", then reply "Oh, I had that backwards."
  - Trivial D: on "reset()", ask "Just confirming: reset() starts a new episode?"
  - Trivial E: on any sentence, say "Thanks, that's clear."
  - Trivial F: on "Gymnasium", ask "Can you say that in one sentence?"

  Then read the results:
  ```bash
  cd /home/quokka/.t3/projects/t3-sidechat-dev && sqlite3 -readonly .t3/userdata/statev2.sqlite "SELECT json_extract(payload_json,'$.sideChat.label'), json_extract(payload_json,'$.sideChat.done.outcome.status'), json_extract(payload_json,'$.sideChat.done.outcome.note') FROM orchestration_v2_projection_threads WHERE json_extract(payload_json,'$.sideChat') IS NOT NULL AND deleted_at IS NULL ORDER BY created_at"
  ```
  Pass: A to C are `ready` with a note naming the gap or misconception, and D to F are `none`. If they are not, refine the `outcome_note` copy in Task 7 (a new commit with a test of the changed phrase), restart, and rerun. Record every run in the table.
- [ ] **Step 5: Stop exactly what you started.**
  ```bash
  cd /home/quokka/.t3/projects/t3-sidechat-dev
  pgid=$(cat .t3/dev-e2e.pid); kill -TERM -- "-$pgid"
  timeout 60 bash -c "while kill -0 -- -$pgid 2>/dev/null; do sleep 1; done" && echo stopped
  ```
  Expected: `stopped`. med uploads the video to the PR (never commit it).

### Task 58: Internals note, final checks and the PR into fork `main`

**Files:**
- Create `docs/internals/side-chats.md`.
- Modify `docs/internals/context-handoffs.md`: one paragraph on side-chat `manual_context` handoffs. `docs/user/side-chats.md` belongs to fork-setup Part B Task 12.

**Interfaces:**
- Consumes: Tasks 1 to 57, the per-site tables (Tasks 30 and 55), and the Task 57 results.
- Produces: the PR `feature/side-chats` → `main` on the fork, registered with the thread.

- [ ] **Step 1: Write `docs/internals/side-chats.md`** (under 80 lines). Cover:
  - The data model: app thread vs shell, `sideChatNoteDeliveries` on the parent.
  - The command flow (open, done, the internal completions, `notes.attach`).
  - The two background effects in the text-generation lane, the temp cwd, and model resolution.
  - Opening-context delivery at fresh native contexts.
  - Note delivery at user-run start, with the wait-cap deadlines. The run-start wait holds one of the effect worker's 4 slots (`EffectWorker.ts:835`) while it waits, and the notes it waits for need a lane slot of their own; `SIDE_CHAT_WAIT_CAP_MS` bounds how long a slot is held, and the gate returns before any tree read for messages a person did not send and for threads without side chats (`hasSideChatChildren`).
  - The lesson lock: every command on a side chat takes its lesson's lock first, so Done, cascade Done and auto-Done never race a late write to a descendant.
  - The chain-up and reopen rules.
  - The downgrade-safety rules: no fork or merge-back transfers; before switching back to an official build, no `side-chat.*` outbox row may be pending or running (an official server claims it, cannot decode it, and leaves it `running`, which blocks its thread's lane); and the server never writes `sideChat.*` keybindings to disk on its own. `scripts/fork-service-switch.sh --to-official` enforces the outbox rule and strips user-written `sideChat.*` keybindings.
  - The capability gate.

  Add one paragraph to `docs/internals/context-handoffs.md`: side chats use `manual_context` with `history` undefined and the content in `summaryText`, and notes handoffs are dropped whole when they don't fit.
- [ ] **Step 2: Run the final checks.** Run `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp run check:changed origin/main`. Expected: format, lint, knip, typecheck and the tests beside the changes are all clean. If knip flags an unused contracts constant, move it to the first task that uses it.
- [ ] **Step 3: Commit the docs.** `git add docs/internals/side-chats.md docs/internals/context-handoffs.md && git commit -m "docs: side-chat context and note flow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
- [ ] **Step 4: Push and open the PR.**
  ```bash
  cd /home/quokka/.t3/projects/t3-sidechat-dev
  FORK="$(gh repo view "$(git remote get-url origin)" --json nameWithOwner -q .nameWithOwner)"
  git push -u origin feature/side-chats
  gh pr create --repo "$FORK" --base main --head feature/side-chats --title "feat: side chats" --body-file /tmp/side-chats-pr.md
  ```
  Write `/tmp/side-chats-pr.md` first. It contains:
  - The problem (PRD §1, two sentences) and how side chats solve it (Architecture above).
  - Links to the PRD and the design.
  - The server per-site table (Task 30) and the client per-site table (Task 55).
  - Test evidence: the `vp test run` file list per phase, and the `check:changed` output.
  - The Task 57 note-quality table: every run, with label, status and note.
  - The demo video.
  - Known limits: the official phone app shows side chats as ordinary forks. A user who rebinds `sideChat.askSelection` writes that command into `keybindings.json`, which an official server rejects (it then skips its default-keybinding sync); the server never writes the default itself, and `fork-service-switch.sh --to-official` removes `sideChat.*` entries after its backup. Switching back to official also waits until no side-chat note or summary is being written.
  - The last line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

  Expected: a PR URL. Register it with `link_pull_request`, and ask med to review and squash-merge.

---

## Spec coverage

| Requirement or design section | Tasks |
|---|---|
| R1 Ask from a highlight (toolbar, streaming disabled, nested, shortcut) | 33, 34, 38, 45, 46, 53 |
| R2 Context going in (summary + highlight, fallback, wait ≤15s, nested chain) | 7–11, 14, 16–19 |
| R3 Isolation (no side-chat traffic in the lesson, input isolation) | 16, 17, 26 (prompt exclusion), 30 (shell stream), 43 |
| R4 Nesting and breadcrumb | 5, 16, 35, 37, 45 |
| R5 Done, optional note, Discard, throwaways, auto-Done | 20–22, 24, 25, 27, 28, 45, 46, 57 (eval) |
| R6 Lesson stays quiet; notes ride along (queued, wait, never fail, user-only) | 23, 26, 28, 44, 46 |
| R7 Reopen and redo | 27, 45 |
| R8 Marks in the lesson (survive reloads, fallback chip, note shown) | 50, 51, 37, 45 |
| R9 Map (diagram, scroll, keyboard, palette, themes) | 47–49, 52, 57 |
| R10 Housekeeping (lists, cascade, worktree, approvals in panel) | 29, 30, 45, 46, 54–56 |
| R11 Compatibility and performance (old clients, old servers, quiet shells) | 1, 3, 4, 30, 32, 46 |
| Design §5 lane, replay safety, temp cwd, model | 8, 9, 14, 15, 25, 29 |
| Design §7 per-site decisions | 30, 55 |
| Design §8 cascade | 29 |
| Design Testing (eval, manual end-to-end, `check:changed`) | 57, 58 |

