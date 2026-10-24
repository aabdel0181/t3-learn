# Side chats: design

Status: draft v2 (after builder check + code review) · Date: 2026-10-22
Requirements: [2026-10-22-side-chat-prd.md](./2026-10-22-side-chat-prd.md) (R1–R11 refer to it)
Upstream baseline: `pingdotgg/t3code` @ `22840ab9` (paths below are relative to that repo)

## Intent

Let a learner highlight part of an AI reply and ask about it in a **side chat**
beside the lesson. The side chat starts from a summary of the lesson plus the
highlight. Its traffic never enters the lesson. When the learner finishes, the
lesson's AI gets at most a one-to-two-line note on its next turn, and only if
that note matters. Side chats nest, and a Map tab shows the tree. The why is in
the PRD, §1.

## Decided by med

- Entry: highlight → **Ask in side chat** (next to Cite).
- Context in: highlighted text + a **summary** of the parent (not the transcript).
- Side chats nest. A **graph/map view** is needed for deep nesting.
- Layout **A**: side chat in the **right panel** beside the lesson, with a Map tab next to it. Below 980px the
  panel is an overlay sheet, as Diff is today (shown to med before he picked A).
- When a side chat ends, the parent **stays quiet** until med's next message.
- The note is **AI-written, unreviewed, and optional**: the AI may decide nothing needs sending.
- v1 targets **desktop + web**. Mobile comes later, and v1 must not break it.
- Built in med's fork. Proposed upstream only after med loves it.
- **Sending a lesson message finishes open side chats.** Their notes ride along with that message, so med never
  has to remember Done. _(Designer's refinement: only idle side chats. One whose AI is still answering stays open,
  and the next lesson message picks it up.)_
- **The Map is a diagram** (boxes and lines) to start. Med may switch to an outline later, so the tree data and
  the layout are kept separate from the drawing.
- **Day-to-day use is a Mac desktop build of the fork.**
- _(Q2, waiting, went unanswered; the designer's default stands: sending waits up to ~15s for a summary or note
  still being written, then goes ahead without it.)_

## Calls made by the designer (med can veto)

- **Same provider for background writing.** Summaries and notes use the _lesson's own provider_ with its small
  text model (e.g. Claude → Haiku), so lesson content never goes to a second provider. They fall back to the
  global text-generation setting only when the lesson's provider can't generate text. Failures are shown as
  "Couldn't write the note", never as "No note sent".
- **Side chat AI.** Same provider, model and runtime mode as the lesson, in the lesson's workspace, so it can read
  code you ask about. Its framing says: answer the question, and don't change files unless explicitly asked.
- **Composer v1.** Text and quotes only: no attachments, slash commands, model switching or plan mode.
- **Notes travel up a chain.** A nested side chat reports to the side chat it came from. When that one finishes,
  its own note writer reads any undelivered notes from its children, so a gap found three levels deep can still
  reach the lesson.
- **Done always works.** If the side chat's AI is still answering, Done stops it and writes the note from what's
  there. Done also finishes any open nested side chats below it.
- **Throwaways.** A side chat closed with no messages is deleted. An overflow-menu **Discard** deletes a side chat
  without sending a note.
- **One side chat per highlight.** Asking again on an overlapping highlight in the same reply reopens the existing
  side chat.
- **Quiet notifications.** No toast, sound or desktop notification for a side chat while its lesson is on screen.
  Elsewhere they notify as usual, and "Open" goes to the lesson with that side chat in the panel.
- **No "Open as full thread"** in v1 (scope).
- **Merge-back is refused for side chats** (from any client or agent) with "Use Done for side chats", because a
  full merge-back would replay the side chat into the lesson.
- **Telemetry off in dev**, and no new telemetry event in v1.
- **The citation bug** (providers receive raw `t3-citation://` links for Cite) ships as a _separate small PR_
  before side chats. It is also a good first upstream contribution.

## Constraints

- **AGENTS.md** applies: performance first (nothing extra on the shell stream, quiet atoms for panel chrome, no
  repaint animations); "hit every surface" (palette, keybinding, reverse states); contracts in
  `packages/contracts`; the server is event-sourced and tests drain the effect worker (no sleeps or timeouts); the
  React Compiler must compile every file (no `useMemo`/`useCallback`, and no `try/finally` in components); no
  repo-wide checks locally.
- **Wire compatibility.** Add **no new literal to any strict union**: `relationshipToParent`, transfer `type` and
  `resolution.strategy`, handoff `strategy`, turn item `type`, `KeybindingCommand` for server upserts. Add only
  **optional fields** (older peers strip them). Gate the client on a capability flag.
- **Downgrade safety.** Side chats must create **no pending `fork` or `merge_back` transfers**. An official server
  reading this database would treat those as ordinary forks or merge-backs and replay full transcripts. With the
  model below, an official server sees side chats as plain threads without context, which is harmless.
- **No SQL migration.** Thread payloads are stored as JSON and projected wholesale
  (`apps/server/src/orchestration-v2/ProjectionStore.ts:776-795, 1940-1965`). New structs use ISO strings, not
  `DateTime`, so the JSON twin (`orchestrationV2.ts:1942-1968`) needs no mapping.
- **Shells stay slim.** Shells go to every client, phones included. Excerpts, summaries and notes live on the app
  thread (thread detail), not the shell.
- **Dev safety on this machine.** The agent shell inherits `T3CODE_HOME=~/.t3`, the live install. Develop and run
  dev servers only from a **linked git worktree**, confirm with `vp run dev --dry-run`, set
  `T3CODE_TELEMETRY_ENABLED=false`, and never kill processes by pattern.

## How it works

### 1. Data model (contracts)

`packages/contracts/src/orchestrationV2.ts`:

- `OrchestrationV2AppThread.sideChat?` (full, thread detail only):
  ```ts
  sideChat?: {
    lessonThreadId: ThreadId;          // nearest non-side-chat ancestor (Map root); not lineage.rootThreadId
    anchor: {
      threadId: ThreadId;              // the thread highlighted in (lesson or parent side chat)
      messageId: MessageId; turnItemId?: TurnItemId;
      start: number; end: number; prefix: string; suffix: string; // AssistantCitation selector
    };
    excerpt: string;                   // ≤ 4000 chars (Ask shows "Shorten selection" above that)
    excerptContext: string;            // ≤ 1500 chars: surrounding paragraph(s), extracted on the server
    label: string;                     // ≤ 120 chars, for tags, breadcrumb and Map
    opening: { status: "pending" | "ready" | "fallback" | "failed"; text: string | null; requestId: string };
    done: null | {
      at: string;                      // ISO
      outcome: { status: "generating" | "ready" | "none" | "failed"; note: string | null; requestId: string;
                 error?: string };
    };
  }
  ```
- `OrchestrationV2ThreadShell.sideChat?` (slim): `{ lessonThreadId, anchor, label, state: "open" | "done",
  noteStatus: "generating" | "ready" | "none" | "failed" | null, excerptLength }`. Built field by field in **both**
  `threadShellFromProjection` (`ProjectionStore.ts:1569-1655`) and `shellFromState` (`:1826-1900`), and mapped in
  the client's `presentThreadShell` (`packages/client-runtime/src/state/models.ts:277-343`).
- `OrchestrationV2AppThread.sideChatNoteDeliveries?: Record<ThreadId, string /* outcome requestId */>` on the
  **parent**, recording which child notes were delivered.
- Lineage: `relationshipToParent: "fork"`, `parentThreadId` = the anchor thread, `forkedFrom: null`, so no
  inherited rows (`ProjectionStore.buildVisibleTurnItems`, 1435-1480).
- Capability: `sideChats: Schema.optionalKey(Schema.Boolean)` in `ExecutionEnvironmentCapabilities`
  (`packages/contracts/src/environment.ts:110-155`), set in `apps/server/src/environment/ServerEnvironment.ts`.
- Predicate `isSideChatThread(threadOrShell)` lives in **contracts**, next to `isProviderNativeSubagentThread`
  (`orchestrationV2.ts:446-451`), because both server and clients need it.
- `deriveSideChatTree(shells, lessonThreadId)` in `packages/client-runtime/src/state/threadRelationships.ts`
  returns ordered rows `{threadId, parentId, depth, label, state, noteStatus}`. It guards against cycles and
  missing parents, and is shared with mobile later.

### 2. Commands

Use dedicated commands, not flags on `thread.fork` / `thread.merge_back`. An older server then rejects them loudly
instead of silently doing an ordinary fork. Public (in `OrchestrationV2Command`):

- `thread.side_chat.open { commandId, threadId (new, client-allocated), anchorThreadId, anchor, excerpt, createdAt? }`,
  routed to the new thread's lock.
- `thread.side_chat.done { commandId, threadId, discard?: boolean }`, routed to the side chat.

Internal (in `OrchestrationV2InternalCommand`, `orchestrationV2.ts:3022+`):

- `thread.side_chat.opening.complete { threadId, requestId, status, text }`
- `thread.side_chat.outcome.complete { threadId, requestId, status, note, error? }`

Both are guarded: they are dropped unless `requestId` matches and the status is still `pending` / `generating`, the
same staleness guard as `thread.title.regeneration.complete` (`ThreadTitleRegenerationService.ts:54-64`).

Wire each new command through the usual places: the command unions, `commandThreadId` routing
(`Orchestrator.ts:465-503`), `withCreationProvenance` / `existingThreadIdsForCommand`
(`ThreadManagementService.ts:67-110`), the `ws.ts` span annotation (1828-1845), the Orchestrator dispatch switch,
and client-runtime ops (`packages/client-runtime/src/operations/commands.ts`, `state/threadCommands.ts`).

### 3. Open (server)

`thread.side_chat.open`:

- Validates that the anchor thread exists and is not archived, and that the anchored message exists. **No source run
  is required**, so it works after an interrupted or failed run and while a newer run streams. Only the highlighted
  message itself must not be streaming.
- Creates the thread by reusing the settings-copy part of `ThreadForkService.plan`
  (`ThreadForkService.ts:85-115`): provider, model, runtime/interaction mode, worktree, branch. It must **not** copy
  pins, `titleRegeneration`, `limitRecovery`, `historyOrigin` or `sideChat`. It also creates **no context
  transfer**. The title comes from `label`, and the side chat's first message must not trigger title generation (no
  `titleSeed`).
- Extracts `excerptContext` from the anchored message on the server.
- Enqueues the `side-chat.opening` effect (see §5).

Separately, fix the ordinary fork path: `ThreadForkService.plan` spreads `...input.sourceProjection.thread`
(`:86`), so an ordinary fork of a side chat must strip `sideChat`.

**Opening context delivery.** In `Orchestrator.dispatchMessage`, for a thread with `sideChat`, build a
`manual_context` handoff **with `history` undefined and the content in `summaryText`**. `history.coverage` is
replaced by a generic line above ~3.6KB (`ContextHandoffDelivery.ts:50`). `summaryText` is checked against the full
budget (`:63-70`). Content:

1. Framing: a focused side question from someone learning; answer at their level; don't change files unless asked.
2. `opening.text` (the summary). If its status is `fallback` or `failed`: a minimal deterministic context, made of
   the lesson's first user message (the topic) and `excerptContext`, each truncated by characters. Not a transcript
   tail. For nested chats, prepend the parent side chat's own opening text.
3. The excerpt plus `excerptContext`, framed as reference material.

Deliver this whenever the side chat builds fresh provider context: its first turn, a provider switch, or a replaced
native thread. Then later provider changes inside a side chat don't lose it. Render the existing `handoff` turn item
as a quiet "Side chat context" divider; it expands to show what the AI was given, including "used recent context
(summary unavailable)".

### 4. Done and the note (server)

`thread.side_chat.done` on side chat S:

- If S has an active run, interrupt it first (reuse the stop path).
- Run Done on S's open descendants first (cascade, deepest first).
- If S has no messages, or `discard` is set: delete S (and its descendants) and send no note.
- Otherwise set `done = { at, outcome: { status: "generating", requestId } }` and enqueue the `side-chat.outcome`
  effect. Its input is S's transcript, plus any **undelivered child notes** and the child notes S's own turns took
  (chain-up: those reached only S's AI), plus S's previously delivered note, if any, with the instruction "only what's
  new, otherwise null". If a child's note is still `generating`, S's note writer waits for it, bounded by the same
  ~15s cap, and goes ahead without it if the cap passes.
- **Reopen:** a user message sent in a done S clears `done` (state → open). A later Done writes a fresh note.
  No side chat stays open under a done one: a user message in a side chat, or opening a side chat from one, also
  reopens each done side chat above it, so the new note still has an open parent to carry it up.

**Auto-Done on a lesson message.** When a user-authored message is sent in a thread, first run Done on every
**idle** open side chat in that thread's subtree (deepest first, no interrupt). Side chats with an active run stay
open. The finished side chats' notes then follow the waiting rule in §5. A side chat nobody has written in is
skipped: it keeps its tab and draft and does not hold its parent open. Closing its tab, Done, Discard or its parent's
Done still delete it. Pressing Done in the panel is still available and does the same thing immediately.

**Delivery on the parent's next turn.** In P's `dispatchMessage`, for **user-authored messages only** (not wakes,
scheduled tasks or delegated completions):

- Collect P's side-chat children whose `done.outcome.status === "ready"` and whose `requestId` differs from
  `P.sideChatNoteDeliveries[child]`. Reading other threads under P's lock is fine, since merge-back already reads the
  fork's items.
- Build one `manual_context` handoff (`history` undefined). Its `summaryText` is
  `Side-chat notes (the user asked about these separately; don't reply to them directly):` followed by one line per
  note: `• re "<label>": <note>`.
- Emit a metadata update on P that records the delivered `requestId`s (a single-thread emission on P).
- If the notes don't fit the context budget, drop them and log it. They must never make the lesson's turn fail
  (`ContextHandoffBudgetError`, `ContextHandoffDelivery.ts:79`).
- Queued messages: attach notes when the **queued run starts** (`~Orchestrator.ts:1650-1830`), not when it's queued.
  That picks up notes that became ready meanwhile and survives queue cancel/steer.
- Show the existing `handoff` turn item as a collapsed "Side-chat notes included" divider. It is not a message.

Notes from nested side chats are collected the same way by their parent side chat, which is what lets them travel
up the chain.

None of this touches `pendingMergeBackTransfers` or the merge-back guards.

### 5. Background writing (effects + text generation)

- Effects `side-chat.opening` and `side-chat.outcome` follow the thread-title pattern (`EffectOutbox.ts:109-134`,
  `EffectWorker.ts:506-522`, `ThreadTitleRegenerationService.ts`). They write results by dispatching the internal
  completion commands.
- **Own lane:** widen the title-only lane rule in `claimableCandidatePredicate` (`EffectOutbox.ts:348-358`) into a
  "text-generation lane" that holds `thread-title.generate` and both side-chat effects. Text generation must never
  hold up `provider-turn.start` on any thread.
- Cap the text-generation lane's share of the worker's slots (global concurrency is 4, `EffectWorker.ts:835`) so a
  burst of side chats can't stall turn starts elsewhere.
- Add both effect types to `REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS` (`EffectOutbox.ts:123`). Catch failures,
  record them as status `failed` and keep them off the outbox's failed-row path, since failed rows pin worktrees in
  storage cleanup (`EffectOutbox.ts:149-155`).
- **Timing:** the opening summary starts the moment Ask is clicked (while med types), and the note starts the moment
  Done is pressed (while med reads). If one is still pending when med sends, the send waits up to ~15s, showing
  "Preparing context…" in the side chat or "Adding side-chat note…" in the lesson, then goes ahead. The side chat
  uses the minimal fallback; the lesson takes the note on its following turn. The wait happens on the server
  (the run start waits on the effect's completion command, bounded by a timer), not in the client, so it also
  covers auto-Done.
- **Text generation:** add one operation, `generateSideChatText({ kind: "opening_summary" | "outcome_note", input })
  → { text: string | null }`, to `ProviderTextGeneration`
  (`packages/provider-core/src/server/textGeneration.ts:97-117`). Implement it with `fromRunner` and prompts in
  `textGenerationPrompts.ts`. Fill in every place that lists operations: Muse, the ACP-registry stub, the
  CodexManagedProvider wrapper, the OpenCode driver (`packages/provider-opencode/src/server/driver.ts:152-160`), the
  router's `Operation` union (`apps/server/src/textGeneration/TextGeneration.ts:30-35`), and the test fakes.
- **Isolation:** run it in a temp directory for **every** provider, not just Claude titles
  (`ClaudeTextGeneration.ts:190-200`; Codex also loads the project's `AGENTS.md` today), so project instructions
  don't leak into summaries.
- **Model:** resolve it from the lesson's provider instance (its suggested small text model), falling back to
  `settings.textGenerationModelSelection`. ACP-registry instances can't generate text, so they always fall back.
- **Summarizer input:** build it directly, without `formatThreadTitleContext` (which caps at 8k and favors recent
  messages). Budget about 24k chars, prioritizing the anchored message and its neighbors, then the first user
  message, then the most recent messages. Include the anchor thread's own `opening.text` for nested chats.
- **Note prompt:** one or two sentences, ≤ 300 chars, _only_ if the lesson's AI should teach differently (a revealed
  gap, a misconception, a preference). Otherwise null. Null is the default.

### 6. Web UI

- **Toolbar** (`apps/web/src/components/chat/AssistantSelectionToolbar.tsx`): refactor the single button into a
  container with **Cite** and **Ask in side chat**, with roving focus. Tab, Escape and `onPointerDown` behave as
  today. While the highlighted message streams the button is disabled with a tooltip, and above 4000 chars it reads
  "Shorten selection". Show it only when `capabilities.sideChats` is set, and keep it disabled while a dispatch is in
  flight. Thread `onAskInSideChat` through `MessagesTimeline` and `ChatView` (~3263).
- **Optimistic open:** open the panel surface immediately using the client-allocated `ThreadId` and the
  locally-known excerpt, showing "Starting side chat…". Focus the side-chat composer, keep typing in
  `composerDraftStore` under the new thread, hold Send until the shell arrives, and on failure close the panel with
  a toast. Write it as an atom command that settles into a result, not `try/finally`. If the maximized panel would
  hide the lesson, un-maximize it.
- **Side-chat panel:** a right-panel surface `{ id: "side-chat:<topSideChatId>", kind: "side-chat", threadId }` in
  `apps/web/src/rightPanelStore.ts` (version bump + migration, surface title and icon, `RightPanelSurfaceContent.tsx`,
  `closedViewStore.ts` reopen, and reconciliation when the side chat is deleted, like `reconcileFileSurfaces`). It
  lives on the **lesson's** panel (`byThreadKey`). Nested side chats navigate in place with a breadcrumb. Show
  `rightPanelAvailable` whenever side-chat or Map surfaces exist (`ChatView.tsx:3125`). Contents:
  - Header: breadcrumb, **Done**, and an overflow menu with **Discard**.
  - Pinned excerpt, collapsed to ~3 lines with an expand control. Clicking it scrolls the lesson to the highlight,
    using citation navigation intercepted so the route doesn't change. It is not a selection source in v1.
  - Timeline: a `SideChatTimeline` wrapper around `ThreadTimeline` that opts out of the held-timeline cache
    (`ThreadTimeline.tsx:45-62`). It passes `routeThreadKey` = the side chat, no-ops for fork, rollback, revert and
    worktree actions, in-panel navigation for `onOpenThread`, a null anchor with simple at-end state, its own
    padding (timeline padding only exists under `[data-chat-canvas]`, `index.css:2450`), and its own `onCite` aimed
    at the side chat's draft. Do **not** mount a second `ChatView`.
  - Slim composer: `ComposerPromptEditor` plus a small shared send helper extracted from `useComposerSend`, reusing
    the operate-scope check, in-flight dedupe, provider-available check, `formatOutgoingPrompt`,
    `getComposerPromptLengthValidationMessage` and `withMessageContext`. It sends via `threadEnvironment.startTurn`
    with the side chat's model and modes. Send is blocked while the side chat's run is active (v1). It keeps local
    optimistic rows, fed into `ThreadTimeline`'s optimistic messages.
  - Pending approvals and questions from the side chat's AI render in the panel. When med opens the lesson while one
    is pending, the panel opens on that side chat.
  - When done, the panel shows "Sent to lesson: …", "No note needed", "Writing note…" or "Couldn't write the note".
- **Input isolation (R3):** add a `[data-side-chat-panel]` scope and respect it in `shouldRedirectInputToComposer`
  (`composerFocusRedirect.ts:61-80`), `usePasteToFocusComposer`, `useComposerStash`, `useChatShortcuts` /
  `getShortcutContext` and `composerFocus`. Keystrokes and pastes inside the panel go to the side-chat composer,
  never the lesson's. Composer chords are scoped to the focused composer, and PageUp/PageDown scroll the panel's
  list. The panel's `onUseArtifactTemplate` / `onSendAppMessage` and `ComposerHandleContext` consumers must not
  target the lesson composer.
- **Toolbar inside the panel:** the toolbar portals to `document.body`. In the sheet layout (<980px), portal it into
  the sheet so the modal's focus trap and outside-press dismissal don't break Cite or Ask.
- **Marks in the lesson (R8):** for each child anchored to a mounted assistant row, resolve the range from the
  shell's offsets and prefix/suffix and paint it with the CSS Custom Highlight API. Repair the range with a
  `MutationObserver` (Shiki, math and mermaid change the DOM after mount) and a `ResizeObserver` (opening the panel
  reflows the column). Clicks go to an absolutely-positioned tag inside the row, or to a `caretPositionFromPoint`
  hit test; CSS highlights don't receive clicks. Feed anchors from a per-(thread, message) atom over quiet child
  shells. If the range can't be resolved, show a "↳ N side chats" chip in the message meta row. If the anchored
  message is gone (rollback), the Map is the way in, and undelivered notes still deliver.
- **Map:** a right-panel surface `{ id: "thread-map", kind: "thread-map" }`, also offered in the panel's "+" launcher
  (`RightPanelTabs` `availableActions`). It renders `deriveSideChatTree` from a stable-array atom over quiet shells
  filtered by `sideChat.lessonThreadId` (pattern: `relationshipShellsAtomFamily`, `apps/web/src/state/entities.ts:430-450`).
  It is a **diagram**, in three separable layers so an outline can replace the drawing later:
  1. data: `deriveSideChatTree` (client-runtime, shared);
  2. layout: a pure `layoutSideChatTree(rows, {nodeWidth, nodeHeight, gapX, gapY})` returning node boxes and edge
     paths. Use a simple tidy-tree layout: leaves get consecutive x slots, each parent is centred over its children,
     and y comes from depth. It is unit-tested and needs no dependency;
  3. drawing: SVG for the edges (curves, `--muted-foreground` at reduced opacity), with nodes as **HTML buttons**
     absolutely positioned over the SVG, so focus, tooltips with the full label and text truncation work. Each node
     shows a status dot (`ThreadRelationshipIcon`); the current node is accent-outlined, the lesson node bold.
     Width: the diagram scrolls horizontally inside the panel and auto-scrolls the current node into view on open.
     A "fit" toggle scales it to the panel width. Keyboard: `role="tree"` with `aria-level`; Up → parent, Down → first
     child, Left/Right → siblings, Enter opens. No animation, theme tokens only. Click or Enter opens a side chat in the
     panel; the lesson node focuses the lesson.
- **Keybinding** `sideChat.askSelection`. Its default must not collide: **Mod+Shift+L is taken**
  (`composer.previousWorktree`, `packages/shared/src/keybindings.ts:206`). The resolver reaches whichever toolbar
  instance owns the current selection through a small registry. Add a label in `KeybindingsSettings.logic.ts`.
- **Palette:** "Open side-chat map" and "Finish side chat (Done)" (`CommandPalette.tsx` ~1290-1345), gated on the
  capability. Palette thread search may return side chats, and choosing one opens its lesson with the panel.

### 7. Subagent special cases: per-site decisions

About 22 places special-case `relationshipToParent === "subagent"`. The builder audits all of them and records a
decision per site in the PR. Known sites and their decisions:

| Site                                                                                | Decision for side chats                                                                                   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/Sidebar.logic.ts:515-551`                                  | hide; `resolveSidebarRowThreadId` → lesson                                                                |
| `packages/client-runtime/src/state/threadShell.ts:405-415` (navigation shells)      | hide                                                                                                      |
| `threadShell.ts:282-300` (child input bubbling)                                     | bubble to the lesson; its banner opens the panel instead of navigating (`useThreadLifecycle.tsx:415-447`) |
| `ThreadRelationshipsControl.tsx` (Lineage list, Merge back, row navigation 327-355) | hide side chats from Lineage                                                                              |
| `ThreadNotificationCoordinator.tsx:131/181/205`                                     | quiet while the lesson is on screen; "Open" → lesson + panel                                              |
| `IdleCompaction.ts:53`                                                              | skip side chats                                                                                           |
| `ShellStream.ts:117-131`, `ws.ts:998-1002, 1157-1161`                               | keep side-chat transcript deltas off the shell stream                                                     |
| `ThreadManagementService.ts:741` (`t3_thread_list`)                                 | hide from agents' listings                                                                                |
| `AgentAwarenessRelay.ts:518`                                                        | don't publish side-chat activity to phones                                                                |
| `storageCleanup.ts:148-171` (`worktreeOwner`)                                       | side chats don't pin the lesson's worktree                                                                |
| `apps/mobile/src/features/threads/threadListV2.ts:229-233, 618-620`                 | hide (this fork's mobile build only)                                                                      |
| `Orchestrator.dispatchThreadMergeBack`                                              | refuse when the source is a side chat                                                                     |

### 8. Delete and archive cascade (new)

No child cascade exists today: `thread.archive` / `thread.delete` act on one thread (`Orchestrator.ts:3565`). Add a
`side-chat.cascade` effect that runs after `thread.archive`, `thread.unarchive` or `thread.delete` of a thread with
side-chat descendants, and dispatches the same command to each descendant. Then MCP, mobile and every client get the
cascade for free.
A side chat whose parent is still archived cannot be unarchived on its own; it comes back with its parent, and the
Archive page lists only the parent.

## Testing

- **Server integration** (models: `apps/server/src/orchestration-v2/testkit/ThreadFork.integration.test.ts`,
  `ThreadMergeBack.integration.test.ts`; drain `OrchestrationEffectWorkerV2`):
  - Opening: the first provider prompt contains the framing, summary and excerpt and **none** of the lesson's other
    messages. The fallback contains only the topic and `excerptContext`. A nested chat carries the parent side chat's
    opening text. Opening works after an interrupted lesson run.
  - Context survives a provider switch inside the side chat.
  - Notes: after Done, the lesson's next _user_ prompt contains exactly the ready notes. `none` and `failed` add
    nothing. A wake or scheduled run doesn't consume notes. A queued lesson message picks up notes ready by its start.
    Several side chats are combined into one handoff. A note too big for the budget is dropped without failing the
    turn. A chain-up note from a grandchild reaches the lesson after both levels finish.
  - Done interrupts an active run; Done cascades to open children; Done with no messages deletes; Discard deletes
    with no note; reopen + Done again writes "only what's new".
  - Auto-Done: a lesson message finishes idle open side chats (and their nested ones) and carries their notes,
    leaves busy side chats open, and waits up to the cap for a note still being written.
  - The text-generation lane: a pending summary never delays `provider-turn.start`.
  - Staleness: an outcome completion with an old `requestId` is dropped.
  - Downgrade: side chats create no pending fork or merge-back transfers.
  - Cascade archive/unarchive/delete; worktree cleanup isn't blocked; merge-back from a side chat is refused; an
    ordinary fork of a side chat has no `sideChat`.
- **Unit:** `deriveSideChatTree`, `isSideChatThread`, the summaryText builders, excerpt-context extraction, and the
  summarizer input budgeting.
- **Web browser tests** (`*.browser.test.tsx`, `await using screen = await render(...)`): the toolbar's two actions,
  focus, Escape, streaming-disabled and "Shorten selection"; Ask opens the panel optimistically without a route
  change and focuses the composer; typing and pasting inside the panel never reach the lesson composer; Cite inside
  the panel targets the side chat; Done on a nested chat returns to its parent; Map keyboard navigation.
- **Note quality eval (R5 AC2):** before merge, run 6 recorded side chats (3 that reveal a gap, 3 trivial) against
  the real text model and attach the results to the PR.
- **Manual end-to-end:** the PRD success scenario on a dev server started from a worktree with seeded data
  (`vp run dev`; the first run seeds from a read-only copy of the live DB), opened from med's Mac. Record the demo
  video from this run.
- Before pushing: `vp run check:changed` against the fork's `main`.

## Repository and shipping

- Fork `pingdotgg/t3code` to `aaawonzo/t3code` (`gh repo fork`). `origin` = the fork, `upstream` = pingdotgg.
- The fork's CI uses `blacksmith-*` runners a personal fork doesn't have. Relabel them to `ubuntu-latest` in a first
  small commit (or disable Actions) and rely on local checks.
- PR 1 (small): fix citation expansion for providers at the real prompt paths (`ProviderTurnStartService.ts:1022`,
  `ProviderTurnControlService.ts:364`, or centrally in `ProviderSessionManager.ts:1865/1878`; **not** line 422, the
  auth slash-command check), and fix the stale `docs/internals/assistant-citations.md` / `context-handoffs.md`.
- PR 2: side chats, on `feature/side-chats`, built in a linked worktree, as a PR within the fork (feature → fork
  `main`), with the PRD/design linked, the per-site table, test evidence, the eval results and the demo video. Merge
  after review.
- Docs: `docs/user/side-chats.md` (user guide), which says plainly that the official phone app shows side chats as
  ordinary threads; a short `docs/internals/` note on the side-chat context and note flow.
- **Day-to-day: a Mac desktop build of the fork.**
  - Build an arm64 `.dmg` with a fork-only GitHub Actions workflow on a `macos-latest` runner (free for public
    repos), via `vp run dist:desktop:dmg:arm64`, and attach it to a GitHub Release on the fork. Fallback: med runs
    the same command on the Mac. The build is unsigned (no Apple Developer ID), so the first launch needs
    right-click → Open.
  - The fork build **replaces** the official app on the Mac and keeps med's existing data (`~/.t3`). It must
    **disable the desktop auto-updater** and server self-update; otherwise the next official release silently
    replaces the fork. Updating means rebasing the fork on `upstream/main` and rebuilding (document a short
    script). Always build from a fork that is at or ahead of the official version that last ran, so the database is
    never newer than the app.
  - **The Ubuntu server runs the fork too (v1).** med uses the Mac app connected to projects on this Ubuntu
    machine. Side chats need fork code on both ends: the client UI lives in the Mac app and the commands live in
    the server. Ship two artifacts from the **same fork commit**, so the orchestration protocol versions match
    (mismatched versions are refused, `docs/user/updating.md`):
    1. the Mac desktop build (above);
    2. a fork server runtime for Ubuntu, installed **next to** the official one under `~/.t3/runtime/versions/<fork
       version>/`. The `t3code.service` user unit (`~/.config/systemd/user/t3code.service`, currently `ExecStart=…/
       0.0.46-nightly.20261015.3145/t3 __service-launcher`) is pointed at it. Same `T3CODE_HOME`, so med keeps all
       threads. The fork is built from upstream `main` (2026-10-22), which is newer than that nightly, so the
       database moves forward, never backward.
  - **Self-update off on both ends.** Turn off the desktop auto-updater, server self-update, and the "update every
    connected machine" button's server updates in fork builds. Otherwise either end can be silently replaced by an
    official release, and the two ends stop matching.
  - **Switching the Ubuntu service is the last step and must not be done from inside a T3 thread.** This machine's
    T3 server hosts the agent sessions, including the one building this feature, so restarting it kills them
    mid-turn. Provide a script (`scripts/fork-service-switch.sh`, fork-only) that med runs from a plain terminal:
    `--to-fork` / `--to-official` rewrite `ExecStart`, run `daemon-reload`, restart, and check health. The rollback
    to an official build is the same script with `--to-official`. The downgrade-safety rule in §Constraints is
    what makes that rollback safe.
  - **The switch script protects live threads.** Before restarting it must:
    1. **Refuse** if any thread has an active run, a queued run or a running workflow. It checks this with a
       read-only query of `statev2.sqlite`, or through the server API. It lists the busy threads, so med can wait.
       med specifically depends on "Audit AI PCB Eval Verdicts" (PCB-GOD project, 516+ runs).
    2. Take an **online SQLite backup** of `~/.t3/userdata/statev2.sqlite` (plus `settings.json`) into
       `~/.t3/backups/fork-switch-<timestamp>/`, and print the restore command.
    3. After restarting, check health and that the thread count matches.
  - **Rollback goes to a current official build, not the old nightly.** The fork may run upstream migrations newer
    than `0.0.46-nightly.20261015`. Starting that older server on the migrated database is unsafe, so
    `--to-official` installs or uses an official release at or after the fork's upstream base.
  - A fork-to-fork upgrade repeats the same pair: rebase onto `upstream/main`, build both, install, switch.
- Upstream later: an Ideas discussion with the demo, then mobile and MCP tools if maintainers want them, then one
  focused PR.

## Left to the builder

- Exact prompt wording for summaries and notes, within the rules above.
- How the marks and tags are drawn in the lesson, within the constraints above.
- The keybinding default (anything that doesn't collide).
- The cap on text-generation lane slots.
- Splitting the work into reviewable commits.
