# Citation Expansion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Providers receive cited assistant quotes (Cite in composer) as readable reference material instead of raw percent-encoded `t3-citation://` links, at turn start and when steering.

**Architecture:** Both provider prompt paths already turn a persisted user message into provider text through one shared function, `projectComposerContextForProvider` (`ProviderTurnStartService.ts:1022-1025`, `ProviderTurnControlService.ts:364-367`). That function becomes the single place that also expands citations: it takes citations out of the user's prose first, projects context references from what is left, and appends the `<assistant_citations>` block last. No server file changes; persisted messages keep their link form.

**Tech Stack:** TypeScript, Effect v4 (`effect`, `@effect/vitest`), `vite-plus` test runner (`vp`), packages `@t3tools/shared` and `t3` (apps/server).

**Spec:** `docs/superpowers/specs/2026-10-22-side-chat-design.md` (§"Calls made by the designer", last bullet; §"Repository and shipping", PR 1). Requirements context: `docs/superpowers/specs/2026-10-22-side-chat-prd.md`. Repo rules: `AGENTS.md` and `CONTRIBUTING.md` of the fork checkout.

## Global Constraints

- Prerequisite: fork setup Part A is done (the fork confirmed in fork-setup Task 1, checkout `~/.t3/projects/t3-sidechat` with `origin` = fork and `upstream` = pingdotgg, `vp` installed, dev worktree `$DEV` = `/home/quokka/.t3/projects/t3-sidechat-dev` seeded and set up by fork-setup Tasks 4-5). This plan ships before the side-chat plan. Commands derive the fork's `owner/name` from `origin`; never hard-code it.
- Work only in the dev worktree `$DEV` on branch `fix/citation-expansion` (fork-setup Task 4: later plans branch there). It already has `.env` linked (`T3CODE_TELEMETRY_ENABLED=false`), dependencies installed and a seeded `.t3`. PR goes into the fork's `main`.
- Line numbers are from upstream `22840ab9`. Fork `main` is `22840ab9` plus the `docs/superpowers` commits, so they should match; if not, find the code by the symbol named next to each range.
- The fix lives in `packages/shared/src/composerContextReferences.ts` and `packages/shared/src/assistantCitations.ts` only. Do not edit `ProviderTurnStartService.ts`, `ProviderTurnControlService.ts` or `ProviderSessionManager.ts`.
- Not centralised in `ProviderSessionManager.ts:1837-1879` (`startTurn`/`steerTurn`): that input already holds rendered handoff history and the `<t3_context>` envelope, so expanding there would read captured and historical text as citations and mix their blocks into the current message.
- `ProviderTurnStartService.ts:422` (`providerAuth.tryHandlePromptCommand`) is not a prompt path. It receives the same projection; a cited message is never a logout prompt either way, so it needs no change and no test.
- Provider text order is fixed: prose with `[assistant-quote-N]` and context markers, then `\n\n<t3_context version="1">…</t3_context>` if any context is referenced, then `\n\n<assistant_citations>…</assistant_citations>` if any citation is present.
- Persisted messages keep the original text. The projection runs only when the effect worker builds provider input; no command, event or projection write changes.
- Input limits apply after expansion. No new server-side limit. The composer gate `getComposerPromptLengthValidationMessage` (`apps/web/src/components/chat/composerSubmission.ts:12-23`) already checks `max(raw, expanded)` against `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` = `120_000`. For prompts without context references the provider text must equal `expandAssistantCitationsForProvider(text)`, so that gate measures exactly what is sent.
- Out of scope, unchanged: handoff history (`historicalMessage` in `packages/provider-core/src/server/handoffBudget.ts:138-179`) replays a user message's persisted text, links included, as it already does for context links. Answers to agent questions (`respondToRuntimeRequest`) are untouched. Task 2 documents the first.
- Tests: no sleeps, timeouts, polling or `retry`. Effect tests use `it.effect` / `effectIt.effect`. Use each module's existing test file.
- Commands: `vp test run <files> [-t "<name>"]`, `vp run --filter <package> typecheck`, `vp lint <files>`, `vp fmt --check <files>`, and before pushing `vp run check:changed origin/main` (`origin` is the fork, so this is fork `main`). No repo-wide checks.
- Dev safety: never touch `~/.t3/userdata` or the `t3code` systemd service, never kill processes by pattern, run dev servers only from the worktree with `T3CODE_TELEMETRY_ENABLED=false`. Task 3's dev server is run by the primary agent or med, never by a task subagent (AGENTS.md).
- Commit only the paths each step names. Plans and specs (`docs/superpowers/`) never go into a commit.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Captured context (terminal excerpt, review diff, page text) that contains a copied `[Assistant quote](t3-citation://…)` link must stay verbatim data inside `<t3_context>` and never become a citation. Pinned by Task 1 "keeps captured context payloads out of citation expansion".
2. A quote whose text shows a literal `t3-context://` link (inline code in a reply) must stay inside the citation JSON and must not resolve a record. Pinned by Task 1 "keeps context links inside quoted text out of the context envelope".
3. A cited follow-up sent while the agent is mid-turn (steer, promote-to-steer) must reach the running turn expanded, like a fresh turn. Pinned by Task 1 "steers the running turn with cited assistant quotes expanded".
4. A cited draft near the 120,000-character limit: what the provider receives must be exactly what the composer measured, so a send the composer allowed never grows on the server. Pinned by Task 1 "reads exactly what the composer measures when no context is referenced".
5. A prompt without citations (plain text, ordinary links, or context links only) must be byte-identical to today. Pinned by the plain-text assertion in the same test, plus the existing "provider projection" tests passing unchanged.

---

## Setup (once, before Task 1)

```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
git status --porcelain
git fetch origin
git switch -c fix/citation-expansion origin/main
test -f .t3/setup-done && readlink .env
vp test run packages/shared/src/composerContextReferences.test.ts packages/shared/src/assistantCitations.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts
```

Expected: `git status --porcelain` prints nothing (stop and ask med otherwise), then `Switched to a new branch 'fix/citation-expansion'`, then `/home/quokka/.t3/projects/t3-sidechat/.env` (the setup script's link; if `.t3/setup-done` is missing, run `T3CODE_PROJECT_ROOT=/home/quokka/.t3/projects/t3-sidechat node scripts/setup-worktree.ts` first, never plain `vp i`), then all four files PASS on the untouched branch. All later commands run from `/home/quokka/.t3/projects/t3-sidechat-dev` (`$WT` below) unless a step says otherwise; shell state does not persist between tool calls, so every step repeats its `cd`.

### Task 1: Expand assistant citations in the provider projection

**Files:**
- Modify: `packages/shared/src/assistantCitations.ts:134-160` (`expandAssistantCitationsForProvider`)
- Modify: `packages/shared/src/composerContextReferences.ts:1-10` (imports), `:291-321` (`projectComposerContextForProvider`)
- Test: `packages/shared/src/composerContextReferences.test.ts` (imports `:1-18`; new `describe` inserted after the `provider projection` describe, which closes at `:267`)
- Test: `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts` (imports `:1-48`; new test after the `continues without interrupting when recovery does not apply` test, which ends at `:814`)
- Test: `apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts` (imports `:1-29`; new test appended after `:331`)

**Interfaces:**
- Consumes: existing `serializeAssistantCitation(citation: AssistantCitation): string` and `expandAssistantCitationsForProvider(prompt: string): string` (`assistantCitations.ts`); `makeLocalCommandHarness(input)` (`ProviderTurnStartService.test.ts:260`); `ProjectionStore.ProjectionProviderControlContext` (`ProjectionStore.ts:273`); `ProviderAdapter.ProviderAdapterV2SteerInput` (`packages/provider-core/src/server/ProviderAdapter.ts:441`).
- Produces:
  - `extractAssistantCitationsForProvider(prompt: string): { readonly text: string; readonly citations: string }` in `packages/shared/src/assistantCitations.ts`. `text` has each citation link replaced by `[assistant-quote-N]`; `citations` is `""` when the prompt has none, otherwise the `<assistant_citations>\n…\n</assistant_citations>` block with no leading blank line.
  - `expandAssistantCitationsForProvider(prompt: string): string`, output unchanged.
  - `projectComposerContextForProvider(input: { text: string; records: ReadonlyArray<ComposerContextRecord> }): string`, same signature, now also expands citations in the order fixed in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Shared tests mirror the fixtures of the `provider projection` describe (`composerContextReferences.test.ts:86-125`) and `readProviderContext` in `assistantCitations.test.ts:48-52`. Change the imports of `packages/shared/src/composerContextReferences.test.ts` to:

```ts
import {
  type AssistantCitation,
  type ComposerContextId,
  type ComposerContextRecord,
  EnvironmentId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
} from "./assistantCitations.ts";
import {
  collectComposerContextReferences,
  formatComposerContextHref,
  isImageReferencesOnly,
  parseComposerContextHref,
  projectComposerContextForProvider,
  threadContextsOutsideEnvironment,
  toComposerContextId,
  toKindScopedComposerContextId,
} from "./composerContextReferences.ts";
```

Insert after line 267:

```ts
describe("assistant citations in the provider projection", () => {
  const citation: AssistantCitation = {
    version: 1,
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make("assistant-1"),
    text: "Keep the parser shared.",
    start: 0,
    end: 23,
    prefix: "",
    suffix: "",
  };
  const terminal: ComposerContextRecord = {
    version: 1,
    contextId: ctx("ctx_t"),
    kind: "terminal",
    label: "Terminal 1 line 3",
    terminalId: "term-1",
    terminalLabel: "Terminal 1",
    lineStart: 3,
    lineEnd: 3,
    text: "boom",
  };
  const citationJson = (projected: string): unknown =>
    JSON.parse(
      projected.slice(
        projected.indexOf("[\n", projected.indexOf("<assistant_citations>")),
        projected.lastIndexOf("\n</assistant_citations>"),
      ),
    );

  it("expands citations from the prose and appends their block after the context envelope", () => {
    const projected = projectComposerContextForProvider({
      text: `Why ${serializeAssistantCitation(citation)} after [log](t3-context://v1/terminal/ctx_t)?`,
      records: [terminal],
    });
    const [beforeCitations] = projected.split("\n\n<assistant_citations>\n");
    expect(beforeCitations).toBe(
      [
        "Why [assistant-quote-1] after [Terminal: log; ref=ctx_t]?",
        "",
        '<t3_context version="1">',
        '<context kind="terminal" id="ctx_t">',
        "terminal: Terminal 1",
        "3 | boom",
        "</context>",
        "</t3_context>",
      ].join("\n"),
    );
    expect(citationJson(projected)).toEqual([{ id: "assistant-quote-1", citation }]);
    expect(projected.endsWith("\n</assistant_citations>")).toBe(true);
    expect(projected).not.toContain("t3-citation://");
  });

  it("keeps captured context payloads out of citation expansion", () => {
    const copied = serializeAssistantCitation(citation);
    const projected = projectComposerContextForProvider({
      text: "Check [log](t3-context://v1/terminal/ctx_t)",
      records: [{ ...terminal, text: copied }],
    });
    expect(projected).toContain(`3 | ${copied}\n</context>`);
    expect(projected).not.toContain("assistant-quote-1");
    expect(projected).not.toContain("<assistant_citations>");
  });

  it("keeps context links inside quoted text out of the context envelope", () => {
    const quoted = { ...citation, text: "Run [log](t3-context://v1/terminal/ctx_t) first." };
    const projected = projectComposerContextForProvider({
      text: `See ${serializeAssistantCitation(quoted)}`,
      records: [terminal],
    });
    expect(projected).toContain("<assistant_citations>");
    expect(projected).not.toContain("<t3_context");
    expect(projected).not.toContain("boom");
    expect(citationJson(projected)).toEqual([{ id: "assistant-quote-1", citation: quoted }]);
  });

  it("reads exactly what the composer measures when no context is referenced", () => {
    const plain = "Compare [docs](https://example.com/a) with the last reply.";
    const quote = serializeAssistantCitation(citation);
    const cited = `Explain ${quote}, then ${quote} again.`;
    expect(projectComposerContextForProvider({ text: plain, records: [] })).toBe(plain);
    expect(projectComposerContextForProvider({ text: cited, records: [terminal] })).toBe(
      expandAssistantCitationsForProvider(cited),
    );
  });
});
```

The second test passes on `main` and must keep passing: it fails if context is projected before citations are expanded over the whole string. The third fails if citations are expanded before context is projected over the whole string.

In `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts`, add `EnvironmentId` to the `@t3tools/contracts` import, add `import { expandAssistantCitationsForProvider, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";`, and insert after line 814:

```ts
effectIt.effect("starts the provider turn with cited assistant quotes expanded", () =>
  Effect.gen(function* () {
    const text = `Why ${serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("environment-citation"),
      threadId: ThreadId.make("thread-citation-source"),
      messageId: MessageId.make("message-citation-source"),
      text: "Keep the parser shared.",
      start: 0,
      end: 23,
      prefix: "",
      suffix: "",
    })}?`;
    const harness = makeLocalCommandHarness({
      text,
      previousTurn: { runStatus: "completed", turnStatus: "completed" },
    });

    yield* harness.start;

    expect(harness.startRootRun).toHaveBeenCalledOnce();
    expect(harness.startRootRun.mock.calls[0]?.[0].message.text).toBe(
      expandAssistantCitationsForProvider(text),
    );
  }),
);
```

In `apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts`, add `EnvironmentId` and `MessageId` to the `@t3tools/contracts` import, add `import { expandAssistantCitationsForProvider, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";`, and append (partial service mocks use `Layer.mock`, as `ProviderTurnStartService.test.ts:124-184` does):

```ts
it.effect("steers the running turn with cited assistant quotes expanded", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread:steer-citation");
    const providerSessionId = ProviderSessionId.make("provider-session:steer-citation");
    const providerThreadId = ProviderThreadId.make("provider-thread:steer-citation");
    const providerTurnId = ProviderTurnId.make("provider-turn:steer-citation");
    const messageId = MessageId.make("message:steer-citation");
    const text = `And ${serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("environment:steer-citation"),
      threadId,
      messageId: MessageId.make("assistant:steer-citation"),
      text: "Keep the parser shared.",
      start: 0,
      end: 23,
      prefix: "",
      suffix: "",
    })}?`;
    const steered: Array<string> = [];
    const runtime = {
      steerTurn: (input: ProviderAdapter.ProviderAdapterV2SteerInput) =>
        Effect.sync(() => {
          steered.push(input.message.text);
        }),
    } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
    const context = {
      providerThread: { id: providerThreadId, providerSessionId },
      providerTurn: { id: providerTurnId, providerThreadId, status: "running" },
      attempt: undefined,
      message: { id: messageId, text, attachments: [], createdBy: "user", creationSource: "web" },
      run: { id: RunId.make("run:steer-citation") },
    } as unknown as ProjectionStore.ProjectionProviderControlContext;
    const layerControl = ProviderTurnControlService.layer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getProviderControlContext: () => Effect.succeed(context),
          }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
            get: () => Effect.succeed(Option.some(runtime)),
          }),
        ),
      ),
    );

    yield* Effect.gen(function* () {
      const control = yield* ProviderTurnControlService.ProviderTurnControlServiceV2;
      yield* control.steer({
        threadId,
        providerSessionId,
        providerThreadId,
        providerTurnId,
        messageId,
      });
    }).pipe(Effect.provide(layerControl));

    assert.deepEqual(steered, [expandAssistantCitationsForProvider(text)]);
  }),
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `vp test run packages/shared/src/composerContextReferences.test.ts -t "assistant citations in the provider projection"`
Expected: 3 FAIL, 1 PASS. "expands citations…" fails on `toBe` with received `Why [Assistant quote](t3-citation://v1/env-1/…`; "keeps context links…" fails with `expected '…' to contain '<assistant_citations>'`; "reads exactly…" fails on the cited `toBe`. "keeps captured context payloads…" PASSES.

Run: `vp test run apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts -t "cited assistant quotes"`
Expected: FAIL; received `Why [Assistant quote](t3-citation://v1/environment-citation/…`, expected `Why [assistant-quote-1]?\n\n<assistant_citations>…`.

Run: `vp test run apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts -t "cited assistant quotes"`
Expected: FAIL on `deepEqual` with the raw `And [Assistant quote](t3-citation://…` string. If either server test fails with a defect such as `unused …` or `A local command must not…` instead, the harness is wrong; fix the test before going on.

- [ ] **Step 3: Implement `extractAssistantCitationsForProvider` in `packages/shared/src/assistantCitations.ts` and the composition in `packages/shared/src/composerContextReferences.ts`**

In `assistantCitations.ts`, move the body of `expandAssistantCitationsForProvider` (lines 135-159) into `export function extractAssistantCitationsForProvider(prompt: string): { readonly text: string; readonly citations: string }`. It returns `{ text: prompt, citations: "" }` when `collectAssistantCitations` finds nothing. Otherwise it returns the marker `text` and, as `citations`, the template `<assistant_citations>\n${description}\n${data}\n</assistant_citations>`, with `text`, `description` and `data` built exactly as today. Then:

```ts
export function expandAssistantCitationsForProvider(prompt: string): string {
  const { text, citations } = extractAssistantCitationsForProvider(prompt);
  return citations === "" ? text : `${text}\n\n${citations}`;
}
```

In `composerContextReferences.ts`, add `import { extractAssistantCitationsForProvider } from "./assistantCitations.ts";` after the contracts import. Rename the current body of `projectComposerContextForProvider` (lines 291-321) to a private `function projectContextReferences(text: string, records: ReadonlyArray<ComposerContextRecord>): string` (replace `input.text` and `input.records`; no other change), and export:

```ts
export function projectComposerContextForProvider(input: {
  text: string;
  records: ReadonlyArray<ComposerContextRecord>;
}): string {
  // Citations leave the prose before context references resolve: captured context
  // payloads are data and must not become citations, and quoted text must not
  // resolve a context reference.
  const { text, citations } = extractAssistantCitationsForProvider(input.text);
  const projected = projectContextReferences(text, input.records);
  return citations === "" ? projected : `${projected}\n\n${citations}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `vp test run packages/shared/src/composerContextReferences.test.ts packages/shared/src/assistantCitations.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts apps/web/src/components/chat/composerSubmission.test.ts apps/web/src/composer-logic.test.ts`
Expected: all PASS. The existing `expandAssistantCitationsForProvider` tests and the web length-check tests prove its output did not change.

Run: `vp run --filter @t3tools/shared typecheck` then `vp run --filter t3 typecheck`
Expected: both exit 0.

Run: `vp lint packages/shared/src/assistantCitations.ts packages/shared/src/composerContextReferences.ts packages/shared/src/composerContextReferences.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/assistantCitations.ts packages/shared/src/composerContextReferences.ts packages/shared/src/composerContextReferences.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts
git commit -F - <<'EOF'
fix(server): agents read cited quotes instead of raw citation links

Turn start and steer project user text through projectComposerContextForProvider,
which now expands assistant citations from the prose before context references
are projected and appends the citation block last.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 2: Correct the internal docs

**Files:**
- Modify: `docs/internals/assistant-citations.md:24-29`
- Modify: `docs/internals/composer-context-references.md:60`, `:71`, `:126`
- Modify: `docs/internals/context-handoffs.md:1-19` (full rewrite)

**Interfaces:**
- Consumes: Task 1's `projectComposerContextForProvider` behaviour and output order.
- Produces: docs only. `docs/user/composer.md:126-130` already promises that sending "tells the agent which words were quoted and which comment you wrote"; Task 1 makes it true, so it stays unchanged.

- [ ] **Step 1: Replace `docs/internals/assistant-citations.md` lines 24-29 with**

```markdown
The server expands citations when it builds provider text from a user message, at turn start
and when steering, inside `projectComposerContextForProvider`
([composer context references](./composer-context-references.md#provider-projection)). Each link
becomes an `[assistant-quote-N]` marker, and one `<assistant_citations>` block after the context
envelope carries the saved excerpts as JSON. The source is never looked up, and the user's
comment stays apart from the quoted text. Citations leave the user's prose before context
references are projected: captured context is data and must not turn into a citation, and quoted
text must not resolve a context reference. Persisted messages keep the link form, which is also
what handoff history replays ([context handoffs](./context-handoffs.md)). Input limits apply after
expansion as well as before it: a draft that fits as encoded links can exceed the provider limit
once expanded, so the composer measures both.
```

- [ ] **Step 2: Edit `docs/internals/composer-context-references.md`**

- Line 60 `` `projectComposerContextForProvider({ text, records })` builds what the provider reads: `` becomes `` `projectComposerContextForProvider({ text, records })` builds what the provider reads. It first replaces [assistant citations](./assistant-citations.md) with markers and appends their block after everything below, then projects context references from the remaining prose: ``
- Line 71 `Text without references is returned unchanged.` becomes `Text without context references or citations is returned unchanged.`
- Line 126 ``The server projects provider text at turn start (`projectComposerContextForProvider`)`` becomes ``The server projects provider text at turn start and when steering (`projectComposerContextForProvider`)``; the rest of the sentence is unchanged.

- [ ] **Step 3: Replace all of `docs/internals/context-handoffs.md` with**

It described handoffs as 240-character summaries; providers actually receive intact historical items (`ContextHandoffService.ts:410-486`, `ContextHandoffDelivery.ts:20-146`, `handoffBudget.ts:109-264`).

```markdown
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
```

- [ ] **Step 4: Check formatting**

Run: `vp fmt --check docs/internals/assistant-citations.md docs/internals/composer-context-references.md docs/internals/context-handoffs.md`
Expected: exit 0. If it reports a file, run `vp fmt <that file>` and check again.

- [ ] **Step 5: Commit, as two commits so the upstream PR can drop the second**

```bash
git add docs/internals/assistant-citations.md docs/internals/composer-context-references.md
git commit -F - <<'EOF'
docs: say where provider prompts expand assistant citations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git add docs/internals/context-handoffs.md
git commit -F - <<'EOF'
docs: describe what context handoffs replay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 3: Verify, capture a runtime transcript, open the fork PR

Run by the primary agent (or med), not a task subagent: it starts a dev server and spends one real provider turn.

**Files:**
- No repository files. Temporary files go to `/tmp` only: `/tmp/citation-prompt.txt`, `/tmp/citation-transcript.txt`, `/tmp/citation-pr.md`.

**Interfaces:**
- Consumes: Tasks 1-2 committed on `fix/citation-expansion`.
- Produces: branch pushed to `origin`, PR `fix/citation-expansion` → the fork's `main` (`$FORK`, derived from `origin` in Step 6).

- [ ] **Step 1: Run the pre-push checks**

Run: `vp run check:changed origin/main`
Expected: the `check:changed summary` lists format, lint, knip, typecheck and test as `pass`.

- [ ] **Step 2: Start a dev server from the worktree**

```bash
WT=/home/quokka/.t3/projects/t3-sidechat-dev
cd "$WT"
vp run dev:server --dry-run
```

Expected: `[dev-runner] mode=dev:server … baseDir=/home/quokka/.t3/projects/t3-sidechat-dev/.t3`. If `baseDir` is `~/.t3` or anything outside the worktree, stop.

Start it in its own process group, as fork-setup Task 5 does, in one foreground tool call:

```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
(setsid env T3CODE_TELEMETRY_ENABLED=false vp run dev:server > .t3/dev-citation.log 2>&1 < /dev/null & echo $! > .t3/dev-citation.pid)
ps -o pid=,pgid=,sid= -p "$(cat .t3/dev-citation.pid)"
```

Expected: three equal numbers. Then wait with the Bash tool's `run_in_background`:
`cd /home/quokka/.t3/projects/t3-sidechat-dev && timeout 600 bash -c 'until grep -q "\"serverVersion\"" .t3/userdata/server-runtime.json 2>/dev/null; do sleep 2; done' && echo up`
Expected: `up`. On timeout, read `.t3/dev-citation.log` and go to Step 5. `.t3/userdata` is already seeded (fork-setup Task 5). If the run in Step 3 reports no usable provider, stop the server with Step 5, copy (never symlink) `~/.t3/userdata/settings.json` into `$WT/.t3/userdata/`, and start it again with this step.

- [ ] **Step 3: Send a cited message and capture what the provider received**

```bash
WT=/home/quokka/.t3/projects/t3-sidechat-dev
cd "$WT/packages/shared"
node --input-type=module -e '
import { serializeAssistantCitation } from "./src/assistantCitations.ts";
const quote = serializeAssistantCitation({ version: 1, environmentId: "env-transcript", threadId: "thread-transcript", messageId: "message-transcript", text: "Keep the parser shared.", start: 0, end: 23, prefix: "", suffix: "" });
process.stdout.write(`In one sentence, what does this quote ask for? Do not run tools or edit files. ${quote}`);
' > /tmp/citation-prompt.txt
cd "$WT/apps/server"
node src/bin.ts project add --base-dir "$WT/.t3" "$WT"
node src/bin.ts thread start --base-dir "$WT/.t3" --wait "$WT" - < /tmp/citation-prompt.txt
```

`project add` may report that the project already exists; that is fine. `thread start --wait` prints `Thread <threadId>` on stderr and the agent's one-sentence reply on stdout. Then:

```bash
WT=/home/quokka/.t3/projects/t3-sidechat-dev
cd "$WT/apps/server"
LOG=$(grep -l 'env-transcript' "$WT"/.t3/userdata/logs/provider/events.*.log | head -1)
{
  echo "## outgoing prompt frame (after fix)"
  grep '"outgoing"' "$LOG" | grep -E '"(turn/start|prompt\.offer|session/prompt)"' | tail -1 \
    | grep -o '\[assistant-quote-1\]\|<assistant_citations>\|t3-citation://' | sort | uniq -c
  echo "## persisted message"
  node src/bin.ts thread show --base-dir "$WT/.t3" --messages 2 <threadId>
} | tee /tmp/citation-transcript.txt
```

Expected: the counts show `1 <assistant_citations>` and `1 [assistant-quote-1]` and no `t3-citation://` line; `thread show` prints the user message in its stored form, still containing `[Assistant quote](t3-citation://v1/env-transcript/…`, and the reply describes the quote.

- [ ] **Step 4 (recommended for the upstream PR): Capture the same frame before the fix**

```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
sed -n 's/.*"startedAt":"\([^"]*\)".*/\1/p' .t3/userdata/server-runtime.json > .t3/dev-citation.started
git checkout origin/main -- packages/shared/src/assistantCitations.ts packages/shared/src/composerContextReferences.ts
```

The server's `node --watch` restarts on the change. Wait for it with the Bash tool's `run_in_background`:
`cd /home/quokka/.t3/projects/t3-sidechat-dev && timeout 300 bash -c 'until grep -q "\"serverVersion\"" .t3/userdata/server-runtime.json 2>/dev/null && ! grep -qF "\"startedAt\":\"$(cat .t3/dev-citation.started)\"" .t3/userdata/server-runtime.json; do sleep 2; done' && echo restarted`
Expected: `restarted`. Then:

```bash
WT=/home/quokka/.t3/projects/t3-sidechat-dev
LOG=$(grep -l 'env-transcript' "$WT"/.t3/userdata/logs/provider/events.*.log | head -1)
cd "$WT/apps/server"
node src/bin.ts thread send --base-dir "$WT/.t3" --wait <threadId> - < /tmp/citation-prompt.txt
{
  echo "## outgoing prompt frame (before fix)"
  grep '"outgoing"' "$LOG" | grep -E '"(turn/start|prompt\.offer|session/prompt)"' | tail -1 \
    | grep -o '\[assistant-quote-1\]\|<assistant_citations>\|t3-citation://' | sort | uniq -c
} | tee -a /tmp/citation-transcript.txt
cd "$WT"
git checkout HEAD -- packages/shared/src/assistantCitations.ts packages/shared/src/composerContextReferences.ts
git status --short
```

Expected: the before block shows only `1 t3-citation://`; `git status --short` prints nothing.

- [ ] **Step 5: Stop the dev server**

Stop exactly the process group started in Step 2 (never kill by pattern or by port owner):

```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
port=$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' .t3/userdata/server-runtime.json)
pgid=$(cat .t3/dev-citation.pid)
kill -TERM -- "-$pgid"
timeout 60 bash -c "while kill -0 -- -$pgid 2>/dev/null; do sleep 1; done" && echo stopped
ss -H -ltn "sport = :$port" | wc -l
```

Expected: `stopped`, then `0`.

- [ ] **Step 6: Push and open the fork PR**

Write `/tmp/citation-pr.md`, pasting `/tmp/citation-transcript.txt` and the provider/model actually used where shown:

````markdown
Cited assistant quotes (Cite in composer) reached providers as raw `t3-citation://` links with
percent-encoded text. `expandAssistantCitationsForProvider` existed but only fed the composer's
length check; no provider prompt path called it, although `docs/user/composer.md` says sending
tells the agent which words were quoted and which comment you wrote.

`projectComposerContextForProvider`, which both provider prompt paths already call (turn start
`ProviderTurnStartService.ts:1022`, steer `ProviderTurnControlService.ts:364`), now takes citations
out of the prose first, projects context references from what is left, and appends the
`<assistant_citations>` block last. Captured context is never read as a citation, and quoted text
never resolves a context reference. Persisted messages are unchanged. For prompts without context
references the provider text equals what the composer already measures against the
120,000-character limit. Docs now say where expansion happens, and `context-handoffs.md`
describes what handoffs actually replay (intact items, user messages in link form).

Evidence
- Failing before the fix, passing after: `vp test run packages/shared/src/composerContextReferences.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts`
- `vp run check:changed origin/main`: all pass
- Runtime transcript (worktree dev server, <provider>/<model>):

```
<contents of /tmp/citation-transcript.txt>
```

Not checked: steering at runtime (unit test only); providers other than <provider>. Handoff
history still replays the link form; unchanged and documented.

Written by Claude Opus 5.5 in Claude Code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
FORK="$(gh repo view "$(git remote get-url origin)" --json nameWithOwner -q .nameWithOwner)"; echo "$FORK"
git push -u origin fix/citation-expansion
gh pr create --repo "$FORK" --base main --head fix/citation-expansion \
  --title "fix(server): agents read cited quotes instead of raw citation links" \
  --body-file /tmp/citation-pr.md
```

Expected: the fork's `owner/name` (the one confirmed in fork-setup Task 1, `aabdel0181/t3code` unless med chose another), then `gh` prints a `https://github.com/$FORK/pull/<n>` URL. `--repo` is required: without it `gh` in a fork targets pingdotgg. If running inside T3 Code, register the PR with `link_pull_request`. After it merges, the side-chat plan's Setup branches `feature/side-chats` from the updated fork `main` in the same `$DEV`.

## Upstream contribution (later, only when med asks)

`CONTRIBUTING.md` lets "a very small, focused fix for an obvious bug" go in without a prior issue or discussion, if the PR explains the defect and why it qualifies. It does here: the internal and user docs describe expansion before dispatch, the expansion helper exists, and no prompt path calls it. If maintainers call it substantial, they want a triaged issue first, so filing a short bug issue with the reproduction and linking it is the safer route. Requirements:

- **One problem per PR.** Send Task 1 plus the first docs commit. The `context-handoffs.md` rewrite fixes a separate stale doc; leave it out, or offer it as its own docs PR if asked.
- **Branch from upstream.** Fork `main` is `22840ab9` plus the `docs/superpowers` commits, which must never go upstream (AGENTS.md "Plans and work artifacts"). Use `git switch -c fix/citation-expansion-upstream upstream/main` and cherry-pick the fix commit and the first docs commit. Before pushing, run `git diff --name-only upstream/main...HEAD | grep -q '^docs/superpowers/' && { echo 'docs/superpowers must not go upstream'; exit 1; }` and expect no output.
- **Evidence.** Reproduction steps, environment (OS, provider, model, T3 Code version), the focused test commands with results, and the before/after transcript from Task 3, plus what was not checked. Paste evidence into the PR; never commit it.
- **Form.** Conventional, plain-language title; body is the problem in a sentence or two, then the fix; the closing line names the model and harness (Claude Opus 5.5 in Claude Code is an accepted model). Triage is automated and does not promise review or merge.
