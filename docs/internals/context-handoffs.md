# Context handoffs

Portable provider and fork handoffs replay app history as text. They do not claim native provider
context parity and do not reconstruct provider-native session state, tool state, approvals, or
omitted text.

[`historicalMessage`](../../packages/provider-core/src/server/handoffBudget.ts) turns user and
assistant messages, command executions (input, exit code, and output), errors, run interrupt
results, file changes, and proposed plans into intact historical items, and skips other turn item
types. It replays a user message's persisted text, so citation and context links reach the
provider in their stored link form, not as the turn-start projection
([assistant citations](./assistant-citations.md)).

Provider handoffs cover the full eligible app history or the delta since that provider last
participated. Fork merge-back handoffs cover the child's eligible delta items. `selectHistory`
keeps whole items within a byte budget that counts one UTF-8 byte per token:
`T3CODE_CONTEXT_HANDOFF_TOKEN_CAP` (default 16,000, clamped to 1,024–64,000), further reduced at
delivery to fit the model window. It keeps the latest user message, the latest assistant message,
and the first user message, then fills from newest to oldest, and tells the provider how many
items it omitted and how to read them with `t3_thread_read`.

[Delivery](../../apps/server/src/orchestration-v2/ContextHandoffDelivery.ts) injects the history
natively when the adapter implements `injectHistory`; otherwise it prepends the rendered history
to the prompt. When not even the coverage wrapper fits, the turn fails with
`ContextHandoffBudgetError`; a compaction turn defers the handoff to the next ordinary turn
instead.

`summaryText` reaches the provider only for a handoff without `history`. Fork merge-back records
keep 240-character `compactText` lines there for display, and legacy v1 imports keep a transcript
suffix built within a 32,000-character budget. Neither is a limit on what portable handoffs
deliver.

Side chats deliver two handoffs: the opening context of a side chat's fresh provider thread, and
the notes a lesson receives with a user's message ([side chats](./side-chats.md)). Both use
`manual_context` with `history` undefined and their whole content in `summaryText`, so
`selectHistory` has nothing to trim and each arrives whole or not at all. Notes are optional at
delivery. When the summaries do not all fit, `deliverContextHandoffs` drops the whole notes
handoff, logs it, and plans the rest without it, so notes never fail the lesson's turn and never
push out the opening context. Notes count as delivered when they are attached, not when they reach
the provider, so notes dropped for budget are not offered again once the run completes.
