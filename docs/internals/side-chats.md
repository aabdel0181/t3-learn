# Side chats

A side chat lets a learner ask about a highlight in an assistant reply without touching the lesson, the
nearest ancestor thread that is not a side chat. It is an ordinary thread with an optional `sideChat`
field: a `fork` of its anchor with `forkedFrom: null` and no context transfer. The app thread holds the
text (excerpt, summary, note); shells reach every client, so they carry a slim copy from
`threadShellSideChatOf`, which both
[ProjectionStore](../../apps/server/src/orchestration-v2/ProjectionStore.ts) builders must call. The
parent's `sideChatNoteDeliveries` maps each child to the note `requestId` it last received.

Open and Done are dedicated commands, not flags on `thread.fork` or `thread.merge_back`, so an older
server rejects them instead of quietly forking. Internal completions are dropped unless their
`requestId` and status still match
([Orchestrator](../../apps/server/src/orchestration-v2/Orchestrator.ts)). Done stops a running turn,
finishes open descendants deepest first and queues the note; an empty or discarded side chat is deleted
instead. Archive, unarchive and delete reach descendants through a `side-chat.cascade` effect; a side
chat under an archived parent cannot be unarchived alone. A side chat has no page of its own: its route
settles on the lesson with it revealed in the panel
([ThreadRouteView](../../apps/web/src/components/ThreadRouteView.tsx)).

## Background text

`side-chat.opening` and `side-chat.outcome` share a text-generation lane with `thread-title.generate`
([EffectOutbox](../../apps/server/src/orchestration-v2/EffectOutbox.ts)). Lane effects never block the
thread's other effects, and at most `TEXT_GENERATION_LANE_MAX_CONCURRENCY` (2) run at once. The worker
has 4 slots (`DEFAULT_EFFECT_WORKER_CONCURRENCY` in
[EffectWorker](../../apps/server/src/orchestration-v2/EffectWorker.ts)), so summaries cannot stall turn
starts. Neither effect fails: errors are recorded on the side chat as `failed`, since a failed outbox
row pins the lesson's worktree. Text uses the lesson provider's text model, its small default or the
global setting ([`resolveSideChatTextModel`](../../packages/shared/src/serverSettings.ts)), in an empty
temp directory so the project's `AGENTS.md` and `CLAUDE.md` cannot leak into summaries.

## Context in

[ProviderTurnStartService](../../apps/server/src/orchestration-v2/ProviderTurnStartService.ts) hands a
new provider thread the opening context. It waits for the summary before taking the workspace lease,
which the side chat shares with the lesson.

Notes attach at run start, not dispatch, so a queued message sees notes that became ready meanwhile.
[`awaitNotesForRunStart`](../../apps/server/src/orchestration-v2/sideChat/SideChatLifecycleService.ts)
runs inside the `provider-turn.start` effect. It returns before any tree read unless a person sent the
message and `hasSideChatChildren` is true. It waits in the effect, not a command, because the
completions it waits for take the lesson's lock. The wait holds one of the worker's 4 slots, and the
notes need a lane slot and a worker slot of their own, so four waiting turn starts would hold every
slot. `SIDE_CHAT_WAIT_CAP_MS` bounds that; a turn that misses it goes ahead and the note rides the next
user message. The cap counts from the send (a queued message waits once), from Done for a parent's
note, and from its start for the opening. Notes that do not fit the budget are dropped whole ([context
handoffs](./context-handoffs.md)). Snapshots and live events strip every handoff's `summary`; the
side-chat dividers fetch theirs with `orchestration.getTurnItem` when expanded
([WireProjection](../../apps/server/src/orchestration-v2/WireProjection.ts)).

## Locks, chain-up and reopen

Every command on a side chat takes its lesson's lock before its own. Done, cascade Done and auto-Done
write descendants holding only that lock, so a late write (a completion, a reopen) that read a row
before Done could otherwise overwrite Done's `done`. The locks are not reentrant, so the order is
always lesson, then thread.

A side chat's note writer reads every ready note of its direct children, received or not (an earlier
note carrying one may never have reached the lesson), and counts them delivered when its own note
lands. Until the lesson holds one of its notes, a null answer becomes those notes verbatim, so a gap
three levels down reaches the lesson. `sideChatOutcomeRequestId` encodes depth so deeper writers are
claimed first, or a parent could hold a lane slot waiting on a child that cannot start. A side chat is
never open under a done one: a message in a done side chat, or a side chat opened under it, reopens it
and every done ancestor. A note the lesson received is kept as `deliveredNote`, so the next says only
what is new; a nested one is not, since the parent note carrying it may be dropped. A user message also
finishes the idle open side chats below it that have messages; busy ones stay open with their
ancestors, and empty ones stay open because their composer may hold an unsent draft.

## Downgrade safety and the capability gate

An official build must still read this database after a switch back, so:

- Side chats create no `fork` or `merge_back` transfer, which an official server would replay in full.
  A fork of a side chat drops `sideChat`, and merge-back from one is refused.
- A switch back needs no pending or running `side-chat.*` outbox row. An official server claims it,
  cannot decode it and leaves it `running`, which blocks its thread's lane.
- A switch back needs no `sideChat.*` entry in `keybindings.json`: an official server rejects the
  unknown command, then stops syncing defaults. [Keybindings](../../apps/server/src/keybindings.ts)
  never writes a lone default, but a user's own binding is written.

The fork's service-switch script, not the server, is where both are checked. Round-trip limits:

- An official server that touches a lesson or side chat rewrites its payload without `sideChat` and
  `sideChatNoteDeliveries`. After a later switch forward, those side chats show as ordinary forks, and
  ready notes may be sent to the lesson once more.
- Persisted side-chat and Map panel tabs show as blank tabs on an official client; close them.

Older servers reject the commands and strip the optional fields, so clients hide every entry point
unless the server advertises `sideChats`
([ServerEnvironment](../../apps/server/src/environment/ServerEnvironment.ts)).
