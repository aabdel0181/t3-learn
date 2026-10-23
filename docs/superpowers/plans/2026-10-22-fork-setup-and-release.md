# Fork setup and release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part A turns `~/.t3/projects/t3-sidechat` into a checkout of a GitHub fork of
`pingdotgg/t3code` with a safe, seeded dev worktree and a working toolchain. Part B ships the fork
to med: Mac desktop builds and a Linux server runtime from one commit, self-update off in every fork
build, a script med runs to switch `t3code.service` between fork and official builds, user docs, and
the upstream Ideas draft.

**Architecture:** Part A is git, GitHub and toolchain setup with no code changes. Fork `main` is
pinned to the upstream baseline the specs were written against (`22840ab9`) plus the
`docs/superpowers` commits. Part B adds one build-time flag, `__T3CODE_FORK_BUILD__`, defined (server,
desktop, web) only when the build runs with `T3CODE_FORK_RELEASE=1`, which only
`.github/workflows/fork-release.yml` sets. `packages/shared/src/forkBuild.ts` reads it, and each
surface turns its updater off. Tests turn it on with `T3CODE_FORK_BUILD` or a parameter. A
fork-only `workflow_dispatch` workflow builds the unsigned arm64 dmg and the Linux x64 CLI archive
and publishes both with `SHA256SUMS` to release `v<version>`. Fork versions are
`<newest official nightly the fork contains>.fork.<n>`, so t3's own downgrade guards order them
correctly. `scripts/fork-service-switch.sh` refuses to run while any thread is busy, takes an online
SQLite backup, and hands the switch to the target runtime's own `t3 service install` or `t3 update`.
The launcher starts the version named in `runtime/service-state.json`, so changing `ExecStart`
alone would not switch anything. The script then checks health and the thread count.

**Tech Stack:** git, gh 2.102, Vite+ (`vp`), Node 26.12.1 (`package.json` engines), pnpm 12 via vp,
Effect 4 (`effect/Config`, `@effect/vitest`), Vitest browser mode (Playwright Chromium), bash,
sqlite3 CLI, GitHub Actions (`ubuntu-latest`, `macos-latest`), electron-builder through
`scripts/build-desktop-artifact.ts`.

**Spec:** `docs/superpowers/specs/2026-10-22-side-chat-design.md` ("Repository and shipping",
"Constraints") and `docs/superpowers/specs/2026-10-22-side-chat-prd.md` (§6 Release). Repo rules:
`AGENTS.md` (upstream `22840ab9`).

**Global constraints**
- Never modify `/tmp/t3recon/t3code`. It is a read-only reference.
- Agent shells carry `T3CODE_HOME=/home/quokka/.t3`, `T3_BOOT_SERVICE_UNIT=t3code.service` and
  `T3_SERVICE_LAUNCHER_CONTEXT`, because the live T3 Code service spawned them. Therefore:
  - Never run `vp run dev` (or `dev:server`, `dev:desktop`) in the main checkout
    `/home/quokka/.t3/projects/t3-sidechat`. There it falls back to the ambient `T3CODE_HOME`
    (`scripts/dev-runner.ts:732-739`), which is the live install. Dev servers run only in the
    linked worktree `/home/quokka/.t3/projects/t3-sidechat-dev`.
  - Never open `~/.t3/userdata/*` read-write and never start a server against it. Read-only
    copies are fine.
  - Never run `systemctl --user` start, stop, restart or daemon-reload, `t3 service ...`, or
    `t3 update` on this machine. `systemctl --user` acts on med's real user manager whatever `HOME`
    says.
  - **The agent never runs `scripts/fork-service-switch.sh` against the real `HOME`, not even with
    `--dry-run`.** Only its test runs it, with a fake `HOME` and a fake `systemctl` first on
    `PATH`. med runs the real switch from a plain terminal (Task 13).
- Kill only a PID or process group captured at spawn (AGENTS.md "three ways to hurt yourself").
- Steps marked **(med)** need sudo or med's machines. Ask med, then wait.
- Checks: `vp test run <files> [-t "<name>"]`, `vp run --filter <package> typecheck`,
  `vp lint <files>`, and before every push `vp run check:changed origin/main`. Never run
  repo-wide checks.
- Every commit message ends with the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use
  `git commit -m "<title>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- Tests follow AGENTS.md: no sleeps or timeouts, no polling, and `extendEnv: false` for every
  subprocess, so a test never inherits the service variables above.
- **Deliberate deviation from AGENTS.md "Plans and work artifacts"** ("Do not commit implementation
  plans, research notes, or agent scratch files"): fork `main` carries `docs/superpowers/**` (the
  specs, these plans and the Ideas draft of Task 12) so med can read them on GitHub. It applies to
  fork `main` only. Any branch meant for upstream starts from `upstream/main`, and before its push
  `git diff --name-only upstream/main...HEAD | grep -q '^docs/superpowers/' && { echo 'docs/superpowers must not go upstream'; exit 1; }`
  must print nothing.

**Review focus**
- Part A: the old history survives (`backup/pre-fork-main`, docs commits re-applied). `main` is
  exactly `22840ab9` plus docs. The dev server's `baseDir` is inside the worktree. GitHub Actions
  stay off for the whole fork until Task 13, so pushing `main` (whose `ci.yml` triggers on
  `push: main`) queues nothing on runners the fork cannot use.
- Part B: the fork flag can never be set in tests, `vp run dev`, `dev:desktop`, `dev:built` or
  upstream builds: it needs `T3CODE_FORK_RELEASE=1`, which only `fork-release.yml` sets. Each surface
  has a test proving it is off. In the switch script the order is refuse, then backup, then switch,
  then verify, and the restore commands are printed before anything changes. `--to-official` also
  refuses while a `side-chat.*` effect is pending or running (an official server cannot decode it)
  and strips `sideChat.*` keybindings it would reject. Its test cannot reach the real `HOME`,
  `systemctl` or `~/.t3`. Fork version ordering keeps the database from running on code older than
  its migrations.
- `docs/superpowers/**` lives on fork `main` only (the deliberate deviation above). An upstream PR
  must be cut without it.

**Fixed values used below**

| Name | Value |
|---|---|
| Fork | `aabdel0181/t3code`. Confirm in Task 1: the spec says `aaawonzo/t3code`, but GitHub has no account `aaawonzo` (HTTP 404 on 2026-10-22). `gh` is logged in as `aabdel0181`, and `aaawonzo` is only the local git `user.name`. |
| Main checkout (`$MAIN`) | `/home/quokka/.t3/projects/t3-sidechat` |
| Dev worktree (`$DEV`) | `/home/quokka/.t3/projects/t3-sidechat-dev` |
| Upstream baseline | `22840ab943b8418744b48223411e46ba4fdcef1a` (`fix(deps): pin all patched package versions (#23798)`) |
| Base nightly | `v0.1.2-nightly.20261022.3541` (newest nightly tag that is an ancestor of the baseline) |
| Live service today | `~/.config/systemd/user/t3code.service`, `ExecStart=/home/quokka/.t3/runtime/versions/0.0.46-nightly.20261015.3145/t3 __service-launcher`, `~/.t3/runtime/service-state.json` `activeVersion` `0.0.46-nightly.20261015.3145` |

Shell state does not persist between tool calls. Every step repeats its `cd`, or uses absolute
paths.

---

## Part A: fork setup (do first)

### Task 1: Fork upstream on GitHub and keep upstream Actions off

**Files:** none (GitHub state only)

**Interfaces:**
- Consumes: `gh` authenticated on this machine
- Produces: repository `aabdel0181/t3code` (fork of `pingdotgg/t3code`, default branch `main`), with
  GitHub Actions turned off for the whole repository (`actions/permissions` `enabled: false`) until
  Task 13 turns them on with only `fork-release.yml` enabled

Decision: **disable fork Actions rather than relabel `blacksmith-*` runners.** Relabeling means
editing 13 of the 18 workflow files, which conflicts with every upstream rebase. The Blacksmith-only
apt mirror steps (`.github/actions/setup-apt-mirrors/action.yml`, `.github/workflows/ci.yml:133`)
break on hosted runners. Most release jobs need secrets the fork lacks (Vercel, EAS, Apple, Azure,
Discord) or are guarded by `github.repository == 'pingdotgg/t3code'`
(`.github/workflows/release.yml:53`). Keeping them off is repository state, not a diff. Local
`vp run check:changed origin/main` is the gate. Part B adds one fork-only `workflow_dispatch`
workflow.

The fork already exists (created 2026-10-17, `main` at `51f7382`, an ancestor of the baseline).
Actions are **on** at the repository level (`{"enabled":true,"allowed_actions":"all"}`) and GitHub
lists 0 workflows, because nothing has been pushed since the fork was made. `ci.yml:3-7` triggers on
`push: branches: [main]`, so the Task 2 Step 5 push would register the upstream workflows and queue
CI on Blacksmith runners the fork cannot use. Actions must therefore be off before that push.

- [ ] **Step 1: Confirm the fork owner with med**

Run: `gh api user --jq .login; gh api users/aaawonzo --jq .login`
Expected: `aabdel0181`, then `gh: Not Found (HTTP 404)`.
Ask med: "The spec names aaawonzo/t3code, but GitHub has no aaawonzo account and gh is logged in as
aabdel0181. Fork to aabdel0181/t3code?" Continue only after he confirms. If he names another owner,
replace `aabdel0181` throughout this plan: the commands, the default URL in
`scripts/fork-service-switch.sh`, and the README text.

- [ ] **Step 2: Fork without cloning**

Run: `gh repo fork pingdotgg/t3code --clone=false --default-branch-only`
Expected: `aabdel0181/t3code already exists` (the fork was made on 2026-10-17). Only on a brand-new
fork does it print `✓ Created fork aabdel0181/t3code`.

- [ ] **Step 3: Verify the fork**

Run: `gh api repos/aabdel0181/t3code --jq '"\(.fork) \(.parent.full_name) \(.default_branch)"'`
Expected: `true pingdotgg/t3code main`

- [ ] **Step 4: Turn Actions off for the whole repository (before anything is pushed)**

Run:
```bash
gh api repos/aabdel0181/t3code/actions/workflows --jq .total_count
gh api -X PUT repos/aabdel0181/t3code/actions/permissions -F enabled=false
gh api repos/aabdel0181/t3code/actions/permissions --jq .enabled
```
Expected: `0` (no workflow is registered yet, so a workflow-state check here would check nothing),
then no output from the `PUT`, then `false`. Task 2 Step 5 checks after the push that no run was
queued, and Task 13 Step 2 turns Actions on with only `fork-release.yml` enabled.

### Task 2: Turn the local repository into the fork checkout

**Files:**
- Commit (untracked today): `docs/superpowers/plans/*.md`
- No source edits

**Interfaces:**
- Consumes: the fork from Task 1
- Produces: `$MAIN` on branch `main`, which is `22840ab9` plus the `docs/superpowers` commits;
  remote `origin` = `https://github.com/aabdel0181/t3code.git`; remote `upstream` =
  `https://github.com/pingdotgg/t3code.git`, tracking `main` only, with tags fetched; branch
  `backup/pre-fork-main` = the old history

- [ ] **Step 1: Commit the plans on the old history**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat
git status --porcelain
git worktree list
```
Expected: only `?? docs/superpowers/plans/`, and one worktree line (the main checkout). Stop and ask
med if there is anything else.
```bash
cd /home/quokka/.t3/projects/t3-sidechat
git add docs/superpowers/plans
git commit -m "docs: side chat implementation plans" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --porcelain
```
Expected: the commit succeeds, and `git status --porcelain` prints nothing.

- [ ] **Step 2: Keep the old history**

Run: `cd /home/quokka/.t3/projects/t3-sidechat && git branch backup/pre-fork-main main && git log --oneline backup/pre-fork-main`
Expected: 5 lines. The first is `<sha> docs: side chat implementation plans` and the last is
`b6f497d Initial commit`.

- [ ] **Step 3: Add remotes and fetch**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat
git remote add -t main upstream https://github.com/pingdotgg/t3code.git
git remote add origin https://github.com/aabdel0181/t3code.git
git fetch upstream --tags
git fetch origin
git merge-base --is-ancestor 22840ab943b8418744b48223411e46ba4fdcef1a upstream/main && echo base-ok
git describe --tags --abbrev=0 --match 'v*-nightly.*' 22840ab943b8418744b48223411e46ba4fdcef1a
```
Expected: `base-ok`, then `v0.1.2-nightly.20261022.3541`.

- [ ] **Step 4: Rebuild `main` on the baseline and re-apply the docs commits**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat
docs_commits="$(git rev-list --reverse "$(git rev-list --max-parents=0 backup/pre-fork-main)"..backup/pre-fork-main)"
echo "$docs_commits" | wc -l
git switch -C main 22840ab943b8418744b48223411e46ba4fdcef1a
git cherry-pick $docs_commits
git log --oneline -5
git ls-files docs/superpowers
test -f AGENTS.md && test -f t3.json && echo upstream-tree
```
Expected: `4` (9966afb, 34f83ef, 21c3e59 and the plans commit). The cherry-picks apply without
conflicts, because upstream has no `docs/superpowers`. The log shows the 4 docs commits above
`22840ab9 fix(deps): pin all patched package versions (#23798)`. `ls-files` lists both specs and
every plan. Then `upstream-tree`. The old `README.md` and `assets/icon.svg` from "Initial commit"
are now upstream's versions; the originals stay on `backup/pre-fork-main`.

- [ ] **Step 5: Push `main` to the fork**

The fork's `main` (`51f7382`, 2026-10-17) is an ancestor of the baseline (GitHub compare:
`51f7382...22840ab9` is `ahead=1655 behind=0`), so this push is a fast-forward. The lease only
guards against someone having pushed to the fork in the meantime.

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat
test "$(gh api repos/aabdel0181/t3code/actions/permissions --jq .enabled)" = false && echo actions-off
git push --force-with-lease=main:"$(git rev-parse origin/main)" -u origin main
test "$(git rev-parse main)" = "$(gh api repos/aabdel0181/t3code/commits/main --jq .sha)" && echo pushed
```
Expected: `actions-off` (if not, do Task 1 Step 4 first and do not push), then
`51f7382..<sha>  main -> main` (a fast-forward, no `(forced update)`), then `pushed`.

Then check that the push queued nothing:
```bash
gh api repos/aabdel0181/t3code/actions/permissions --jq .enabled
gh run list -R aabdel0181/t3code --limit 5 --json databaseId --jq length
```
Expected: `false`, then `0`.

### Task 3: Install the toolchain

**Files:** none in the repo. The vp installer edits med's shell profile.

**Interfaces:**
- Produces: `vp` on `PATH` in login shells; Node 26.12.1 under vp; the `sqlite3` CLI

- [ ] **Step 1: (med) Install vp, after med agrees**

Ask med first, and continue only after he agrees: "Installing Vite+ runs
`curl -fsSL https://vite.plus | bash`, a remote installer piped into bash. It installs into
`~/.vite-plus` and edits your shell profile so `~/.vite-plus/bin` is on `PATH`. If nvm's Node
(v24.13.1) still wins, Step 2 appends a line putting `~/.vite-plus/bin` first on `PATH` to the end of
`~/.bashrc`, so every new shell then defaults to Node 26.12.1 instead of nvm's v24. Run it yourself,
or let me run it?" If he prefers to run it, he runs the command in a terminal and tells you when it
is done.

Run (only with med's yes): `curl -fsSL https://vite.plus | bash`
Expected: the installer reports its bin directory (`~/.vite-plus/bin`) and the profile it updated.

- [ ] **Step 2: (med) Select Node from `engines`**

`package.json` pins `"engines": { "node": "26.12.1" }`. CI selects the same version
(`.github/actions/setup-ci-deps/action.yml:34`).

Run: `bash -lc 'vp --version && vp env use 26.12.1 && cd /home/quokka/.t3/projects/t3-sidechat && node --version && command -v node'`
Expected: a vp version, then `v26.12.1` and a path under `~/.vite-plus/bin`. If it prints `v24.13.1`
from `~/.nvm`, nvm comes later on `PATH`. Appending
`export PATH="$HOME/.vite-plus/bin:$PATH"` as the last line of `~/.bashrc` fixes it; do that only if
med agreed to the `~/.bashrc` change in Step 1 (otherwise ask him now), then run the step again.

- [ ] **Step 3: (med) Install the sqlite3 CLI**

The switch script and its test (Task 11) need it, and this machine has none. `python3` here is a
custom 3.11 build without `_sqlite3`.
med runs: `sudo apt-get install -y sqlite3`
Verify: `sqlite3 --version` prints `3.45.` or later.

- [ ] **Step 4: Record the libsecret decision**

`libsecret-1-dev` is needed only for the Linux desktop app: `vp run dev:desktop` or
`dist:desktop:linux` (`docs/operations/development.md`, "Linux AppImage prerequisites"). The Mac app
is built in CI (Task 10), so skip it here. If med later wants desktop dev on Ubuntu, he runs
`sudo apt-get install -y libsecret-1-dev pkg-config`.

### Task 4: Create the dev worktree, install dependencies and Playwright, and turn telemetry off

**Files:**
- Create: `/home/quokka/.t3/projects/t3-sidechat/.env` (gitignored; `.gitignore` has `.env`)

**Interfaces:**
- Consumes: Tasks 2 and 3
- Produces: `$DEV` = linked worktree at `/home/quokka/.t3/projects/t3-sidechat-dev`, detached at
  `origin/main`, with dependencies installed and `.env` linked to `$MAIN/.env`
  (`T3CODE_TELEMETRY_ENABLED=false`). Later plans create their branch there with
  `git -C /home/quokka/.t3/projects/t3-sidechat-dev switch -c <branch> origin/main`.

- [ ] **Step 1: Confirm the telemetry switch in code**

Run:
```bash
cd /tmp/t3recon/t3code
grep -n 'T3CODE_TELEMETRY_ENABLED' apps/server/src/telemetry/AnalyticsService.ts
grep -n 'loadRepoEnv()' scripts/dev-runner.ts
```
Expected: `81:  enabled: Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(true)),`
(telemetry is on unless this is set), and `26:Object.assign(process.env, loadRepoEnv());` (the dev
runner loads the repository `.env`, `scripts/lib/public-config.ts:26-40`).

- [ ] **Step 2: Turn telemetry off for dev**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat
printf 'T3CODE_TELEMETRY_ENABLED=false\n' >> .env
git check-ignore .env && cat .env
```
Expected: `.env`, then `T3CODE_TELEMETRY_ENABLED=false`. Keep T3 Connect keys out of this file.
Release builds get them from `.env.example` (Task 10).

- [ ] **Step 3: Add the linked worktree next to the checkout**

Run:
```bash
git -C /home/quokka/.t3/projects/t3-sidechat worktree add --detach /home/quokka/.t3/projects/t3-sidechat-dev origin/main
git -C /home/quokka/.t3/projects/t3-sidechat worktree list
```
Expected: `Preparing worktree (detached HEAD <sha>)`, then two lines: the main checkout `[main]` and
`t3-sidechat-dev (detached HEAD)`.

- [ ] **Step 4: Run the project's setup script (what `t3.json` "Setup Worktree" runs)**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && T3CODE_PROJECT_ROOT=/home/quokka/.t3/projects/t3-sidechat node scripts/setup-worktree.ts`
Expected: `vp i --frozen-lockfile` output ending in a pnpm `Done in …`. Then:
`cd /home/quokka/.t3/projects/t3-sidechat-dev && test -f .t3/setup-done && readlink .env`
prints `/home/quokka/.t3/projects/t3-sidechat/.env`. If `.t3/setup-failed` exists, read its tail and
fix the cause before going on.

- [ ] **Step 5: Install Playwright Chromium (the CI commands)**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
node apps/web/node_modules/playwright/cli.js install --only-shell chromium
node apps/server/node_modules/playwright-core/cli.js install --only-shell chromium
browser=$(find "$HOME/.cache/ms-playwright" -name chrome-headless-shell -type f -print -quit)
test -n "$browser" && { ldd "$browser" | grep '=> not found' || echo libs-ok; }
```
Expected: download lines (or "is already installed"), then `libs-ok`. If a library is missing,
**(med)** runs
`cd /home/quokka/.t3/projects/t3-sidechat-dev && sudo "$(command -v node)" apps/web/node_modules/playwright/cli.js install-deps chromium`
(the CI fallback, `.github/workflows/ci.yml:316-322`).

- [ ] **Step 6: Prove that dev state resolves inside the worktree**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && echo "ambient T3CODE_HOME=$T3CODE_HOME" && vp run dev --dry-run 2>&1 | grep -o 'source=.*'`
Expected: `ambient T3CODE_HOME=/home/quokka/.t3`, then
`source=worktree /home/quokka/.t3/projects/t3-sidechat-dev serverPort=<n> webPort=<n> baseDir=/home/quokka/.t3/projects/t3-sidechat-dev/.t3`.
`--dry-run` only resolves and prints (`scripts/dev-runner.ts:764-769`). If `baseDir` is
`/home/quokka/.t3`, stop: the command did not run inside the worktree.

### Task 5: Seed the dev database with one dev-server run

**Files:** none tracked. Writes `$DEV/.t3/userdata/*`, `.t3/dev-first-run.log` and
`.t3/dev-first-run.pid` (all gitignored).

**Interfaces:**
- Produces: `$DEV/.t3/userdata/statev2.sqlite`, a recent copy of med's projects and stopped threads
  (made by `apps/server/scripts/migrate-dev-db.ts`, which drops scheduled tasks, pending work and
  auth sessions)

- [ ] **Step 1: Start the dev server in its own process group**

Run in one foreground tool call:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
(setsid vp run dev > .t3/dev-first-run.log 2>&1 < /dev/null & echo $! > .t3/dev-first-run.pid)
ps -o pid=,pgid=,sid= -p "$(cat .t3/dev-first-run.pid)"
```
Expected: three equal numbers. The captured PID leads its own process group, so Step 4 can stop
exactly what was started.

- [ ] **Step 2: Wait for the server to publish its runtime state**

Run it with the Bash tool's `run_in_background`, because the first start seeds and warms the Vite
cache:
`cd /home/quokka/.t3/projects/t3-sidechat-dev && timeout 900 bash -c 'until grep -q "\"serverVersion\"" .t3/userdata/server-runtime.json 2>/dev/null; do sleep 2; done' && echo up`
Expected: `up`. On timeout, read `.t3/dev-first-run.log` and go to Step 4.

- [ ] **Step 3: Verify the seed, the isolation and the telemetry setting**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
grep -o '\[dev-runner\] seeding [^ ]* from [^ ]*' .t3/dev-first-run.log
sqlite3 -readonly .t3/userdata/statev2.sqlite 'SELECT count(*) FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL;'
pid=$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' .t3/userdata/server-runtime.json)
tr '\0' '\n' < "/proc/$pid/environ" | grep -E '^T3CODE_(HOME|TELEMETRY_ENABLED)='
origin=$(sed -n 's/.*"origin":"\([^"]*\)".*/\1/p' .t3/userdata/server-runtime.json)
curl -fsS "$origin/.well-known/t3/environment" | grep -o '"serverVersion":"[^"]*"'
```
Expected:
`[dev-runner] seeding /home/quokka/.t3/projects/t3-sidechat-dev/.t3 from /home/quokka/.t3/userdata/statev2.sqlite`.
Then a positive thread count, then `T3CODE_HOME=/home/quokka/.t3/projects/t3-sidechat-dev/.t3` and
`T3CODE_TELEMETRY_ENABLED=false`, then `"serverVersion":"0.1.1"`.

- [ ] **Step 4: Stop exactly what you started**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
port=$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' .t3/userdata/server-runtime.json)
pgid=$(cat .t3/dev-first-run.pid)
kill -TERM -- "-$pgid"
timeout 60 bash -c "while kill -0 -- -$pgid 2>/dev/null; do sleep 1; done" && echo stopped
ss -H -ltn "sport = :$port" | wc -l
```
Expected: `stopped`, then `0`.

### Task 6: Prove the toolchain with focused upstream tests

**Files:** none

**Interfaces:**
- Consumes: Tasks 3 to 5
- Produces: evidence that the Node, browser and scripts test projects, typecheck and lint all run
  in `$DEV`

- [ ] **Step 1: Node and Effect test (shared)**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp test run packages/shared/src/devHome.test.ts`
Expected: `Test Files  1 passed (1)` and `Tests  5 passed (5)`.

- [ ] **Step 2: Server test**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp test run apps/server/src/cloud/serviceLauncherClient.test.ts`
Expected: 1 file passed, 0 failed.

- [ ] **Step 3: Browser test (Playwright Chromium)**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp test run apps/web/src/components/settings/SecretInput.browser.test.tsx`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 4: Scripts test with a real subprocess and HTTP (the model for Task 11)**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp test run scripts/build-npm-launcher.test.ts`
Expected: all passed.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp run --filter @t3tools/shared typecheck && vp lint packages/shared/src/devHome.ts`
Expected: typecheck exits 0, and lint reports `0 warnings and 0 errors`.

Part A is done. The citation-fix and side-chat plans run next in `$DEV`.

---

## Part B: release (do last, after side chats merge into fork `main`)

Branch for all of Part B. Run this once, before Task 7:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
git fetch --multiple --tags origin upstream
git grep -q 'isSideChatThread' origin/main -- packages/contracts/src/orchestrationV2.ts && echo side-chats-merged
git switch -c fork/release origin/main
```
Expected: `side-chats-merged`, then `Switched to a new branch 'fork/release'`. `git fetch` needs
`--multiple` to fetch two remotes; without it `upstream` is read as a refspec on `origin`
(`fatal: couldn't find remote ref upstream`). The check looks for the feature's code, not a commit
subject: fork `main` already carries "docs: side chat …" commits, so grepping the log for "side chat"
always matches. If `side-chats-merged` is missing, stop and do not switch: Part B runs after the
side-chat PR merges.

### Task 7: Fork-build flag; desktop auto-updater off

**Files:**
- Create: `packages/shared/src/forkBuild.ts`
- Modify: `packages/shared/package.json` (add the `"./forkBuild"` export next to `"./cliRelease"`, about line 418)
- Modify: `apps/desktop/src/app/DesktopConfig.ts:36-64` (add the `forkBuild` field)
- Modify: `apps/desktop/src/updates/DesktopUpdates.ts:310-333` (`getAutoUpdateDisabledReason`) and `:418-430` (`resolveDisabledReason`)
- Modify: `apps/desktop/vite.config.ts:15-19` (`publicConfigDefine`)
- Test: `apps/desktop/src/updates/DesktopUpdates.test.ts` (next to "keeps the disabled reason available after configuration and channel changes")

**Interfaces:**
- Produces (`@t3tools/shared/forkBuild`):
  - `isForkBuildBundle(): boolean`: true only in bundles built with `__T3CODE_FORK_BUILD__`
  - `ForkBuildConfig: Config.Config<boolean>`: env `T3CODE_FORK_BUILD`, defaulting to `isForkBuildBundle()`
  - `readForkBuild: Effect.Effect<boolean>`: `ForkBuildConfig`, falling back to `isForkBuildBundle()` on a config error
- Produces: `DesktopConfig.forkBuild: boolean`. Desktop updater disabled reason:
  `"Automatic updates are off in this fork build. Rebuild the fork to update."`

- [ ] **Step 1: Write the failing test**

```ts
  it.effect("never checks for updates in a fork build", () => {
    const harness = makeHarness({ env: { T3CODE_FORK_BUILD: "true" } });
    const reason = "Automatic updates are off in this fork build. Rebuild the fork to update.";

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const configured = yield* updates.getState;
        assert.equal(configured.status, "disabled");
        assert.equal(configured.message, reason);

        const result = yield* updates.check("menu");
        assert.equal(result.checked, false);
        assert.equal(harness.checkCount(), 0);
      }),
    ).pipe(Effect.provide(harness.layer));
  });
```

- [ ] **Step 2: Run the test to verify that it fails**

Run: `vp test run apps/desktop/src/updates/DesktopUpdates.test.ts -t "never checks for updates in a fork build"`
Expected: FAIL with `expected 'idle' to equal 'disabled'`. The harness has mock updates on and nothing reads `T3CODE_FORK_BUILD` yet.

- [ ] **Step 3: Implement the flag and the desktop gate**

`packages/shared/src/forkBuild.ts`. The text is fixed, because three packages and three build
configs depend on the define name:
```ts
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

declare const __T3CODE_FORK_BUILD__: boolean | undefined;

/**
 * Fork release bundles must never replace themselves with an official release. The build
 * configs (apps/server, apps/desktop and apps/web) define `__T3CODE_FORK_BUILD__` only when
 * `T3CODE_FORK_RELEASE=1`, which only .github/workflows/fork-release.yml sets. Tests, `vp run dev`,
 * `dev:desktop`, `dev:built` and upstream builds leave it undefined.
 */
export const isForkBuildBundle = (): boolean =>
  typeof __T3CODE_FORK_BUILD__ !== "undefined" && __T3CODE_FORK_BUILD__;

/** `T3CODE_FORK_BUILD` overrides the bundle flag, so tests can exercise fork behavior. */
export const ForkBuildConfig = Config.Boolean("T3CODE_FORK_BUILD").pipe(
  Config.withDefault(isForkBuildBundle()),
);

export const readForkBuild: Effect.Effect<boolean> = ForkBuildConfig.pipe(
  Effect.orElseSucceed(isForkBuildBundle),
);
```
- `packages/shared/package.json`: add `"./forkBuild": { "types": "./src/forkBuild.ts", "import": "./src/forkBuild.ts" }`.
- `DesktopConfig.ts`: after `disableAutoUpdate`, add `forkBuild: ForkBuildConfig,` (import from `@t3tools/shared/forkBuild`).
- `DesktopUpdates.ts`: add `forkBuild: boolean;` to the `getAutoUpdateDisabledReason` args. Make it
  the first check (`if (args.forkBuild) return "Automatic updates are off in this fork build. Rebuild the fork to update.";`),
  and pass `forkBuild: config.forkBuild` from `resolveDisabledReason`.
- `apps/desktop/vite.config.ts`: add
  `...(process.env.T3CODE_FORK_RELEASE === "1" ? { __T3CODE_FORK_BUILD__: JSON.stringify(true) } : {}),`
  to `publicConfigDefine`, with the comment
  `// Fork release builds never self-update (packages/shared/src/forkBuild.ts). Only fork-release.yml sets T3CODE_FORK_RELEASE.`
  An unconditional define would also reach `vp run dev:desktop`: the desktop `dev` and `dev:bundle`
  tasks run `vp pack --watch` with the same `publicConfigDefine` (`:31-38`, used at `:60, 77, 110`).
  Tests never see it either way.

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `vp test run apps/desktop/src/updates/DesktopUpdates.test.ts && vp run --filter @t3tools/desktop typecheck && vp run --filter @t3tools/shared typecheck && vp lint packages/shared/src/forkBuild.ts apps/desktop/src/app/DesktopConfig.ts apps/desktop/src/updates/DesktopUpdates.ts apps/desktop/vite.config.ts`
Expected: the whole file passes, including the existing tests (the flag is off by default).
Typecheck exits 0, and lint is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/forkBuild.ts packages/shared/package.json apps/desktop/src/app/DesktopConfig.ts apps/desktop/src/updates/DesktopUpdates.ts apps/desktop/vite.config.ts apps/desktop/src/updates/DesktopUpdates.test.ts
git commit -m "feat(desktop): fork builds never auto-update" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Server: no self-update in fork builds

**Files:**
- Modify: `apps/server/src/cloud/selfUpdate.ts:46-52` (`resolveServerSelfUpdateCapability`), `:218-240` (`make`: `capability` and the start of `update`)
- Modify: `apps/server/src/environment/ServerEnvironment.ts:195-199`
- Modify: `apps/server/vite.config.ts:114-117` (`pack.define`, which covers both `dist` and `dist-exe`)
- Test: `apps/server/src/cloud/selfUpdate.test.ts`, `apps/server/src/environment/ServerEnvironment.test.ts`

**Interfaces:**
- Consumes: `readForkBuild` (Task 7)
- Produces: `resolveServerSelfUpdateCapability(input: { readonly desktopManaged: boolean; readonly launcherManaged: boolean; readonly forkBuild: boolean }): ServerSelfUpdateCapability | null`,
  which returns `null` when `forkBuild` is set. A fork server advertises no `serverSelfUpdate`,
  `serverSelfUpdateProgress` or `desktopAppUpdate`, and `ServerSelfUpdate.update` fails with reason
  `"This server runs a fork build of T3 Code, which does not update itself. Rebuild the fork to update it."`

- [ ] **Step 1: Write the failing tests**

`selfUpdate.test.ts`: import `* as ConfigProvider from "effect/ConfigProvider"` and
`* as Layer from "effect/Layer"`. Add `readonly env?: Record<string, string>;` to `HarnessOptions`.
In `makeHarness`, add this as the last item in the `ServerSelfUpdate.make().pipe(...)` chain:
`Effect.provide(options.env === undefined ? Layer.empty : ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env })))`.
Then add:
```ts
  it.effect("refuses every update in a fork build before staging", () =>
    Effect.gen(function* () {
      const { selfUpdate, order } = yield* makeHarness({ env: { T3CODE_FORK_BUILD: "true" } });
      const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);
      expect(error.reason).toBe(
        "This server runs a fork build of T3 Code, which does not update itself. Rebuild the fork to update it.",
      );
      expect(order).toEqual([]);
    }),
  );
```
`ServerEnvironment.test.ts` (import `* as ConfigProvider from "effect/ConfigProvider"`). It mirrors
"publishes proven install ownership only for manually updated servers", in desktop mode, where an
official build would report `"desktop-managed"`:
```ts
  it.effect("advertises no self-update in a fork build", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const config = yield* makeServerConfig(baseDir);
      yield* fs.makeDirectory(config.stateDir, { recursive: true });
      const descriptor = yield* Effect.gen(function* () {
        const environment = yield* ServerEnvironment.ServerEnvironment;
        return yield* environment.getDescriptor;
      }).pipe(
        Effect.provide(
          ServerEnvironment.layer.pipe(
            Layer.provide(layerEmptySecretStore),
            Layer.provide(ServerConfig.layer({ ...config, mode: "desktop" })),
          ),
        ),
        Effect.provideService(HostProcess.Arguments, ["node", `${baseDir}/missing/bin.mjs`]),
        Effect.provideService(HostProcess.IsExecutable, false),
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { T3CODE_FORK_BUILD: "true" } }))),
      );
      expect(descriptor.capabilities.serverSelfUpdate).toBeUndefined();
      expect(descriptor.capabilities.serverSelfUpdateProgress).toBeUndefined();
      expect(descriptor.capabilities.desktopAppUpdate).toBeUndefined();
    }),
  );
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `vp test run apps/server/src/cloud/selfUpdate.test.ts -t "refuses every update in a fork build" && vp test run apps/server/src/environment/ServerEnvironment.test.ts -t "advertises no self-update in a fork build"`
Expected: both FAIL. In the first, the update succeeds, so `Effect.flip` fails and `order` is not
empty. In the second, `expected 'desktop-managed' to be undefined`.

- [ ] **Step 3: Implement the server gate**

- `resolveServerSelfUpdateCapability`: add `readonly forkBuild: boolean`, with `if (input.forkBuild) return null;` as the first line.
- `selfUpdate.ts` `make`: after `const inFlight`, add `const forkBuild = yield* readForkBuild;`.
  Replace the inline `capability` expression (`:224-225`) with
  `resolveServerSelfUpdateCapability({ desktopManaged: serverConfig.mode === "desktop", launcherManaged: launcher.managed, forkBuild })`.
  As the first statement of `update`, add
  `if (forkBuild) return yield* failWith("This server runs a fork build of T3 Code, which does not update itself. Rebuild the fork to update it.");`.
  Without it, the `capability === null` branch would show the misleading "Run `t3 service install`" message.
- `ServerEnvironment.ts`: add `const forkBuild = yield* readForkBuild;` before the call at `:196`, and pass `forkBuild`.
- `apps/server/vite.config.ts` `pack.define`: add
  `...(process.env.T3CODE_FORK_RELEASE === "1" ? { __T3CODE_FORK_BUILD__: JSON.stringify(true) } : {}),`
  with the same comment as the desktop config. Unconditional, it would flag every server pack,
  including the `t3#build` that desktop `dev` depends on.

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `vp test run apps/server/src/cloud/selfUpdate.test.ts apps/server/src/environment/ServerEnvironment.test.ts && vp run --filter t3 typecheck && vp lint apps/server/src/cloud/selfUpdate.ts apps/server/src/environment/ServerEnvironment.ts apps/server/vite.config.ts`
Expected: both files pass in full, typecheck exits 0, and lint is clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/cloud/selfUpdate.ts apps/server/src/cloud/selfUpdate.test.ts apps/server/src/environment/ServerEnvironment.ts apps/server/src/environment/ServerEnvironment.test.ts apps/server/vite.config.ts
git commit -m "feat(server): fork builds refuse self-update" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Web: "Update everything" leaves servers alone in fork builds

**Files:**
- Modify: `apps/web/src/versionSkew.ts:86-90` (`resolveServerSelfUpdateCapability`, the one choke point for the update banner, Connections settings and "Update everything")
- Modify: `apps/web/src/components/sidebar/updateEverything.logic.ts:69-72, 98`
- Modify: `apps/web/vite.config.ts:232-255` (`define`)
- Test: `apps/web/src/components/sidebar/updateEverything.logic.test.ts`

**Interfaces:**
- Consumes: `isForkBuildBundle` (Task 7)
- Produces: `resolveServerSelfUpdateCapability(serverConfig, forkBuild = isForkBuildBundle()): ServerSelfUpdateCapability | null`
  and `collectServerUpdateTargets(machines, targetVersion, forkBuild = isForkBuildBundle())`.
  Existing call sites are unchanged.

- [ ] **Step 1: Write the failing test** (in `describe("collectServerUpdateTargets")`, reusing `machine()`)

```ts
  it("leaves every server alone in a fork build", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("service", "0.0.40", "boot-service"),
        machine("other-desktop", "0.0.40", "desktop-managed"),
      ],
      "0.0.50",
      true,
    );

    expect(targets).toEqual([]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["service", "needs a manual update"],
      ["other-desktop", "needs a manual update"],
    ]);
  });
```

- [ ] **Step 2: Run the test to verify that it fails**

Run: `vp test run apps/web/src/components/sidebar/updateEverything.logic.test.ts -t "leaves every server alone in a fork build"`
Expected: FAIL. `targets` lists `service` and `other-desktop`, because the third argument is ignored.

- [ ] **Step 3: Implement**

- `versionSkew.ts`: add the second parameter `forkBuild = isForkBuildBundle()` (import from
  `@t3tools/shared/forkBuild`), with `if (forkBuild) return null;` first.
- `updateEverything.logic.ts`: add the third parameter `forkBuild = isForkBuildBundle()` and call
  `resolveServerSelfUpdateCapability(config, forkBuild)` at `:98`.
- `apps/web/vite.config.ts`: in `define`, add
  `...(process.env.T3CODE_FORK_RELEASE === "1" ? { __T3CODE_FORK_BUILD__: JSON.stringify(true) } : {}),`
  with the comment `// Fork release builds only (fork-release.yml): tests and dev keep upstream update behavior.`
  Keying on `command === "build"` would not do: `dev:built` runs `vp build --watch`.

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `vp test run apps/web/src/components/sidebar/updateEverything.logic.test.ts apps/web/src/versionSkew.test.ts && vp run --filter @t3tools/web typecheck && vp lint apps/web/src/versionSkew.ts apps/web/src/components/sidebar/updateEverything.logic.ts apps/web/vite.config.ts`
Expected: everything passes. The existing tests still see `serverSelfUpdate` because the flag is
off under Vitest (`T3CODE_FORK_RELEASE` is unset).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/versionSkew.ts apps/web/src/components/sidebar/updateEverything.logic.ts apps/web/src/components/sidebar/updateEverything.logic.test.ts apps/web/vite.config.ts
git commit -m "feat(web): fork builds skip server updates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Fork release workflow and version script

**Files:**
- Create: `scripts/fork-version.sh` (executable)
- Create: `.github/workflows/fork-release.yml`

**Interfaces:**
- Produces: `scripts/fork-version.sh [<ref>]`, which prints `<base nightly>.fork.<n>`, for example
  `0.1.2-nightly.20261022.3541.fork.9`. `<n>` counts the fork's commits since the merge base with
  `upstream/main`. The version sorts after the nightly it contains and before the next one (checked
  against `compareExactServiceVersions`, `apps/server/src/cloud/serviceProtocol.ts:111`). It
  passes `isExactServiceVersion`. `cliReleaseChannelOf` calls it `stable` and
  `resolveDesktopUpdateChannel` calls it `latest`, so the app is named `T3 Code (Beta)` and uses the
  production icons.
- Produces: workflow `fork-release.yml` with `workflow_dispatch` input `version`. It publishes
  release `v<version>` on the fork with assets `T3-Code-<version>-arm64.dmg`,
  `t3-<version>-linux-x64.tar.gz` and `SHA256SUMS`. The URL layout matches
  `cliReleaseDownloadBaseUrl` (`packages/shared/src/cliRelease.ts:51-56`).

- [ ] **Step 1: Write `scripts/fork-version.sh`**

```bash
#!/usr/bin/env bash
# Prints the fork release version for <ref> (default HEAD): the newest official nightly the fork
# contains, then .fork.<commits on top>. It sorts after that nightly and before the next one, so
# t3's downgrade guards never let the database run on code older than its migrations.
set -euo pipefail
ref="${1:-HEAD}"
git fetch --quiet upstream main --tags
base="$(git merge-base "$ref" upstream/main)"
nightly="$(git describe --tags --abbrev=0 --match 'v*-nightly.*' "$base")"
printf '%s.fork.%s\n' "${nightly#v}" "$(git rev-list --count "$base..$ref")"
```
Then run `chmod +x scripts/fork-version.sh`.

- [ ] **Step 2: Verify its output**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && bash -n scripts/fork-version.sh && scripts/fork-version.sh origin/main | grep -E '^0\.1\.2-nightly\.20261022\.3541\.fork\.[0-9]+$'`
Expected: one line, such as `0.1.2-nightly.20261022.3541.fork.8`. The base is `22840ab9` until the
first rebase.

- [ ] **Step 3: Write `.github/workflows/fork-release.yml`**

The commands mirror `.github/workflows/release-desktop.yml` and
`.github/workflows/desktop-macos-preview.yml`. Leave every signing variable unset (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_API_KEY*`, `APPLE_TEAM_ID`, `MACOS_PROVISIONING_PROFILE`,
`T3CODE_CLI_MAC_SIGN_IDENTITY`). Without `--signed`, `scripts/build-desktop-artifact.ts:4031-4038`
sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and drops them. Copying `.env.example` supplies the public
T3 Connect identifiers that official builds carry. med's server uses the T3 Connect relay, and
without them the fork would lose that link.
```yaml
name: Fork release

# Fork-only. Builds the unsigned macOS arm64 app and the Linux x64 server runtime from one commit
# and publishes both to a GitHub Release on this fork. Upstream workflows stay disabled here.

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Output of scripts/fork-version.sh origin/main"
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: fork-release
  cancel-in-progress: false

env:
  VERSION: ${{ inputs.version }}
  # Turns on __T3CODE_FORK_BUILD__ in the server, desktop and web build configs, so every bundle
  # both jobs build has self-update off. Nothing else sets it.
  T3CODE_FORK_RELEASE: "1"

jobs:
  check:
    name: Check version
    if: github.repository != 'pingdotgg/t3code'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Validate fork version
        run: |
          if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+\.fork\.[0-9]+$ ]]; then
            echo "::error::'$VERSION' is not a fork version; run scripts/fork-version.sh origin/main"
            exit 1
          fi

  server_linux_x64:
    name: Server runtime Linux x64
    needs: check
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          sparse-checkout: |
            /*
            !/.repos/
          sparse-checkout-cone-mode: false

      - name: Setup Vite+
        uses: voidzero-dev/setup-vp@250f29ce396baf5e8f24498e17c0dfdebabc26eb # v1
        with:
          node-version-file: package.json
          cache: true
          run-install: false

      - name: Public T3 Connect configuration
        run: cp .env.example .env

      - name: Align package versions
        run: node scripts/update-release-package-versions.ts "$VERSION"

      - name: Install dependencies
        run: vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/desktop... --filter=@t3tools/scripts...

      - name: Build server and web client
        run: vp run --filter t3 build

      - name: Apply web client branding
        run: node scripts/apply-web-brand-assets.ts production apps/server/dist/client

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@6bed0761d98439e5a578e2877258200ad565ba87 # stable
        with:
          toolchain: stable
          targets: x86_64-unknown-linux-gnu

      - name: Build resource monitor
        run: |
          cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-unknown-linux-gnu
          mkdir -p "$RUNNER_TEMP/cli-resource-monitor/linux-x64"
          cp native/resource-monitor/target/x86_64-unknown-linux-gnu/release/t3-resource-monitor "$RUNNER_TEMP/cli-resource-monitor/linux-x64/"

      - name: Build CLI single-executable
        run: node apps/server/scripts/cli.ts build-exe --verbose

      - name: Build CLI archive
        run: >-
          node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$VERSION"
          --resource-monitor-dir "$RUNNER_TEMP/cli-resource-monitor" --output-dir release-cli

      - name: Smoke-test CLI archive
        run: node scripts/smoke-cli-archive.ts --archive "release-cli/t3-$VERSION-linux-x64.tar.gz" --expect-version "$VERSION"

      - name: Upload server runtime
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: server-linux-x64
          path: release-cli/t3-*-linux-x64.tar.gz
          if-no-files-found: error

  desktop_mac_arm64:
    name: Desktop macOS arm64
    needs: check
    runs-on: macos-latest
    timeout-minutes: 60
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          sparse-checkout: |
            /*
            !/.repos/
          sparse-checkout-cone-mode: false

      - name: Setup Vite+
        uses: voidzero-dev/setup-vp@250f29ce396baf5e8f24498e17c0dfdebabc26eb # v1
        with:
          node-version-file: package.json
          cache: true
          run-install: false

      - name: Public T3 Connect configuration
        run: cp .env.example .env

      # Same as the server job and upstream's release-desktop.yml:206, so the dmg's packages and
      # embedded server report $VERSION like the Linux runtime.
      - name: Align package versions
        run: node scripts/update-release-package-versions.ts "$VERSION"

      - name: Install dependencies
        run: vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/desktop... --filter=@t3tools/scripts...

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@6bed0761d98439e5a578e2877258200ad565ba87 # stable
        with:
          toolchain: stable
          targets: aarch64-apple-darwin

      # Unsigned: without --signed the artifact script disables identity discovery.
      - name: Build unsigned dmg
        run: vp run dist:desktop:dmg:arm64 --build-version "$VERSION" --verbose

      - name: Upload dmg
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: desktop-mac-arm64
          path: release/T3-Code-*-arm64.dmg
          if-no-files-found: error

  release:
    name: Publish release
    needs: [server_linux_x64, desktop_mac_arm64]
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - name: Download artifacts
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8
        with:
          path: assets
          merge-multiple: true

      - name: Write checksums
        working-directory: assets
        run: sha256sum t3-*-linux-x64.tar.gz T3-Code-*-arm64.dmg > SHA256SUMS

      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: >-
          gh release create "v$VERSION" assets/* --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA"
          --title "T3 Code fork $VERSION" --generate-notes
```
The release tag `v…-nightly.….fork.N` matches upstream `release.yml`'s exclusion `!v*-nightly.*`,
so it can never trigger an official release. The generated notes (merged PR titles) are the
changelog entry the PRD asks for.

- [ ] **Step 4: Validate the YAML and the formatting**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev/packages/shared && node -e 'const y=require("yaml");const d=y.parse(require("fs").readFileSync("../../.github/workflows/fork-release.yml","utf8"));console.log(Object.keys(d.jobs).join(","))'
cd /home/quokka/.t3/projects/t3-sidechat-dev && vp fmt --check .github/workflows/fork-release.yml scripts/fork-version.sh --no-error-on-unmatched-pattern
```
Expected: `check,server_linux_x64,desktop_mac_arm64,release`, and no formatting diff (run `vp fmt` on
the files if there is one).

- [ ] **Step 5: Commit**

```bash
git add scripts/fork-version.sh .github/workflows/fork-release.yml
git commit -m "ci: fork release builds the Mac app and the Linux server runtime" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: `scripts/fork-service-switch.sh` and its test

**Files:**
- Create: `scripts/fork-service-switch.sh` (executable)
- Test: `scripts/fork-service-switch.test.ts`. Mirror `scripts/build-npm-launcher.test.ts`:
  `it.layer(NodeServices.layer)`, the `collect` and `run` helpers (`:22-46`, `extendEnv: false`),
  and the `acquireRelease` HTTP server (`:80-92`).

**Interfaces:**
- Consumes: the release layout from Task 10. The runtime layout from `pinnedRuntime.ts:49-66`:
  `runtime/versions/<v>/t3` plus a `.install-complete` file containing `<v>`.
  `t3 service install --base-dir` (`apps/server/src/cli/service.ts:122-139`), which rewrites the
  unit and `runtime/service-state.json` together, then runs `daemon-reload`, `enable` and `restart`
  (`apps/server/src/cloud/bootService.ts:738-890`).
  `t3 update <v> --base-dir --yes` (`apps/server/src/cli/update.ts:224-248`).
  `t3 update ... --allow-downgrade` (`update.ts:204, 386-389`).
  Busy-thread columns from `persistence/Migrations/055_OrchestrationV2.ts:55-87` (threads
  `thread_id, title, deleted_at`; runs `thread_id, status`) and
  `persistence/Migrations/OrchestrationV2/Subagents.ts` (`thread_id, status`).
  Active run statuses are the complement of `isTerminalRunStatus`
  (`apps/server/src/orchestration-v2/ThreadManagementService.ts:453-463`).
  Outbox columns `effect_id, thread_id, effect_type, status`
  (`persistence/Migrations/OrchestrationV2/EffectCancellation.ts:8-25`). The side-chat effect types
  `side-chat.opening`, `side-chat.outcome` and `side-chat.cascade` (side-chat plan Tasks 14, 25, 29).
  The keybindings file `<T3 home>/userdata/keybindings.json` (`apps/server/src/config.ts:132`).
- Produces the CLI:
  `fork-service-switch.sh --to-fork <version> [--archive <file>] [--dry-run] [--health-timeout <s>]`
  and `fork-service-switch.sh --to-official [<version>] [--dry-run] [--health-timeout <s>]`.
  Exit codes: 0 ok, 1 error, 2 usage, 3 busy (threads, or for `--to-official` side-chat effects
  still pending or running). The test hook `T3_FORK_RELEASE_BASE_URL` overrides the default
  `https://github.com/aabdel0181/t3code/releases/download`.

Why not only rewrite `ExecStart`: the service launcher spawns
`runtime/versions/<activeVersion>/t3 serve`, with `activeVersion` read from
`runtime/service-state.json` (`apps/server/src/serviceLauncher.ts:570-580, 862-872`). A new
`ExecStart` with the old state still starts the old version. `t3 service install` writes both,
durably, and refuses downgrades and pending updates. On its first start the fork server prunes
runtimes nothing references (`selfUpdate.ts:182-203`, `pinnedRuntime.ts:603-633`), which removes
the old official runtimes. That is why `--to-official` downloads a current official release with
`t3 update`.

- [ ] **Step 1: Write the failing test**

Build the fixtures and helpers below, then the eight tests. Wrap everything in
`it.layer(NodeServices.layer)("fork-service-switch", (it) => { … })`, and give each test
`it.effect.skipIf(HostProcess.Platform.defaultValue() !== "linux")` (systemd only).
```ts
// @effect-diagnostics nodeBuiltinImport:off - Serves a fake fork release and a fake server over real HTTP to the switch script.
const OFFICIAL = "0.1.2-nightly.20261022.3541";
const FORK = "0.1.2-nightly.20261022.3541.fork.7";
const NEWER_OFFICIAL = "0.1.3-nightly.20261025.3600";

/** A t3 runtime stand-in: logs its arguments and leaves the files the real command leaves. */
const fakeT3 = (version: string) =>
  String.raw`#!/bin/sh
echo "$*" >> "$FAKE_T3_LOG"
case "$1" in
  --version) echo "t3 vVERSION"; exit 0 ;;
  service) home="$4"; to="VERSION" ;;
  update) home="$4"; to="$2" ;;
esac
printf '{\n  "protocol": 3,\n  "activeVersion": "%s"\n}\n' "$to" > "$home/runtime/service-state.json"
printf '{"version":1,"pid":1,"port":1,"origin":"%s","startedAt":"2026-10-22T00:00:00.000Z","serviceManaged":true,"serverVersion":"%s"}\n' "$FAKE_ORIGIN" "$to" > "$home/userdata/server-runtime.json"
`.replaceAll("VERSION", version);

const FAKE_SYSTEMCTL = '#!/bin/sh\necho "$*" >> "$FAKE_SYSTEMCTL_LOG"\n';

// Only the columns the script reads (checked against the real schema in Step 4).
const FIXTURE_SQL = `
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, title TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE orchestration_v2_projection_subagents (subagent_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE orchestration_v2_effect_outbox (effect_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, effect_type TEXT NOT NULL, status TEXT NOT NULL);
INSERT INTO orchestration_v2_projection_threads VALUES
  ('t1', 'Audit AI PCB Eval Verdicts', NULL),
  ('t2', 'RL environments lesson', NULL),
  ('t3', 'Deleted thread', '2026-10-01T00:00:00.000Z');
INSERT INTO orchestration_v2_projection_runs VALUES ('r1', 't1', 'completed'), ('r2', 't2', 'interrupted'), ('r3', 't3', 'running');
INSERT INTO orchestration_v2_effect_outbox VALUES ('e1', 't2', 'side-chat.opening', 'succeeded'), ('e2', 't1', 'thread-title.generate', 'pending');
`;
const BUSY_SQL = `
UPDATE orchestration_v2_projection_runs SET status = 'queued' WHERE run_id = 'r1';
INSERT INTO orchestration_v2_projection_subagents VALUES ('s1', 't2', 'running');
`;
const SIDE_CHAT_EFFECT_SQL = `
INSERT INTO orchestration_v2_effect_outbox VALUES ('e3', 't2', 'side-chat.outcome', 'running');
`;
const KEYBINDINGS_JSON =
  '[{"key":"mod+alt+s","command":"sideChat.askSelection","when":"!terminalFocus"},{"key":"mod+b","command":"sidebar.toggle"}]\n';
```
Helpers (signatures; the bodies use `FileSystem`, `Path` and `run` as in the mirrored file):
- `makeMachine(options: { readonly active: string; readonly busy?: boolean; readonly sideChatEffect?: boolean })` returns
  `{ root, home, t3Home, script }`. It creates a scoped temp root (prefix `t3-fork-switch-test-`) containing:
  - `home/.t3/runtime/versions/<active>/t3`, an executable `fakeT3(active)`, plus `.install-complete` (`<active>\n`)
  - `home/.t3/runtime/service-state.json` with `{\n  "protocol": 3,\n  "activeVersion": "<active>"\n}\n`
  - `home/.config/systemd/user/t3code.service` with `[Service]\nEnvironment=T3CODE_HOME=<t3Home>\nExecStart=<t3Home>/runtime/versions/<active>/t3 __service-launcher\n`
  - `home/.t3/userdata/settings.json` with `{"theme":"dark"}\n`
  - `home/.t3/userdata/keybindings.json` with `KEYBINDINGS_JSON`
  - `bin/systemctl`, an executable `FAKE_SYSTEMCTL`
  - `home/.t3/userdata/statev2.sqlite`, created with `run("sqlite3", ["-batch", "-init", "/dev/null", db, FIXTURE_SQL + (busy ? BUSY_SQL : "") + (sideChatEffect ? SIDE_CHAT_EFFECT_SQL : "")], { cwd: root, env: { PATH: process.env.PATH } })`, asserting exit 0
  - `script` = `yield* path.fromFileUrl(new URL("./fork-service-switch.sh", import.meta.url))`
- `serveFakeHost(machine)` returns `{ baseUrl, corruptChecksum }`. It tars
  `release/t3-${FORK}-linux-${arch}/t3` (executable `fakeT3(FORK)`; `arch` is `"arm64"` when
  `HostProcess.Architecture` is `arm64`, else `"x64"`) into `t3-${FORK}-linux-${arch}.tar.gz` and
  serves three URLs:
  - `/v${FORK}/SHA256SUMS` returns `${sha256}  ${archiveName}\n`
  - `/v${FORK}/${archiveName}` returns the archive
  - `/.well-known/t3/environment` returns `{"serverVersion":"<v>"}`, where `<v>` comes from
    `/"serverVersion":"([^"]*)"/` applied to `NodeFS.readFileSync(<t3Home>/userdata/server-runtime.json)`.
    It answers with whatever version the fake runtime last recorded, like the real server.
  `corruptChecksum()` sets the checksum to `"0".repeat(64)`.
- `switchScript(machine, host, args: ReadonlyArray<string>, extraEnv: Record<string, string> = {})`
  is `run("bash", [machine.script, ...args], { cwd: machine.root, env })` with
  `env = { PATH: ${root}/bin:${process.env.PATH}, HOME: home, FAKE_T3_LOG: ${root}/t3.log, FAKE_SYSTEMCTL_LOG: ${root}/systemctl.log, FAKE_ORIGIN: host.baseUrl, T3_FORK_RELEASE_BASE_URL: host.baseUrl, ...extraEnv }`.
- `readLines(file)` returns `[]` when the file is missing, otherwise its trimmed lines.

Tests and assertions:
1. `"refuses to restart while a thread has an active run, a queued run or a running subagent"`.
   Uses `makeMachine({ active: OFFICIAL, busy: true })` and `--to-fork FORK`. `exitCode` is `3`.
   `stderr` includes `Audit AI PCB Eval Verdicts (t1): run queued` and
   `RL environments lesson (t2): subagent running`, and does not include `Deleted thread`.
   `<t3Home>/backups` does not exist, and `readLines(t3.log)` is `[]`.
2. `"prints the plan on a dry run and changes nothing"`. Args `--to-fork FORK --dry-run`.
   `exitCode` is `0`. `stdout` includes `Running now:    t3 ${OFFICIAL}` and
   `Dry run: nothing changed.`. `<t3Home>/backups` does not exist,
   `readDirectory(<t3Home>/runtime/versions)` equals `[OFFICIAL]`, and `t3.log` is `[]`.
3. `"refuses to switch from a shell inside the T3 Code service"`. Extra env
   `{ T3_BOOT_SERVICE_UNIT: "t3code.service" }`. `exitCode` is `1`, `stderr` includes
   `plain terminal`, and `<t3Home>/backups` does not exist.
4. `"installs a fork release, switches the service and keeps a verified backup"`. Args
   `--to-fork FORK`. `exitCode` is `0`, printing `stderr` on failure.
   - `<t3Home>/runtime/versions/${FORK}/.install-complete` trimmed equals `FORK`.
   - `readLines(t3.log)` deep-equals `["--version", `service install --base-dir ${t3Home}`]`.
   - `<t3Home>/backups` has exactly one entry, matching `/^fork-switch-\d{8}T\d{6}Z$/`.
   - In it, `sqlite3 -batch -init /dev/null <backup>/statev2.sqlite "SELECT count(*) FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL;"` prints `2`.
   - `<backup>/settings.json` equals `{"theme":"dark"}\n`.
   - `systemctl.log` includes `--user is-active --quiet t3code.service`.
   - `stdout` includes `cp '${backup}/statev2.sqlite' '${t3Home}/userdata/statev2.sqlite'` and
     `OK: t3code.service runs t3 ${FORK}; 2 threads (was 2).`.
5. `"rejects a fork release whose checksum does not match"`. Call `host.corruptChecksum()`, then
   `--to-fork FORK`. `exitCode` is `1`, and `stderr` includes `checksum mismatch for t3-${FORK}-linux-`.
   `<t3Home>/runtime/versions/${FORK}` does not exist, `t3.log` is `[]`, and `service-state.json`
   still names `OFFICIAL`.
6. `"switches back to an official release with the fork's own t3 update and drops side-chat keybindings"`.
   Uses `makeMachine({ active: FORK })` and `--to-official NEWER_OFFICIAL`. `exitCode` is `0`.
   `readLines(t3.log)` deep-equals `[`update ${NEWER_OFFICIAL} --base-dir ${t3Home} --yes`]` (no
   `--allow-downgrade`), and `stdout` includes
   `OK: t3code.service runs t3 ${NEWER_OFFICIAL}; 2 threads (was 2).`.
   `JSON.parse(<t3Home>/userdata/keybindings.json)` deep-equals `[{ key: "mod+b", command: "sidebar.toggle" }]`,
   and `<backup>/keybindings.json` equals `KEYBINDINGS_JSON`.
7. `"refuses to switch back while a side-chat note is still being written"`. Uses
   `makeMachine({ active: FORK, sideChatEffect: true })` and `--to-official NEWER_OFFICIAL`.
   `exitCode` is `3`. `stderr` includes `t2: side-chat.outcome running` and does not include
   `side-chat.opening` (settled) or `thread-title.generate` (not a side-chat type).
   `<t3Home>/backups` does not exist, `readLines(t3.log)` is `[]`, and `keybindings.json` still equals
   `KEYBINDINGS_JSON`.
8. `"switches back to the fork's base nightly, the one older official version it allows"`. Uses
   `makeMachine({ active: FORK })` and `--to-official OFFICIAL` (`FORK`'s base nightly, which
   `compareExactServiceVersions` orders before `FORK`). `exitCode` is `0`, `readLines(t3.log)`
   deep-equals `[`update ${OFFICIAL} --base-dir ${t3Home} --yes --allow-downgrade`]`, and `stdout`
   includes `OK: t3code.service runs t3 ${OFFICIAL}; 2 threads (was 2).`.

- [ ] **Step 2: Run the test to verify that it fails**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && command -v sqlite3 && vp test run scripts/fork-service-switch.test.ts`
Expected: the `sqlite3` path, then 8 FAIL. `bash` exits 127 (`No such file or directory`), so
every `exitCode` assertion fails. If `sqlite3` is missing, do Task 3 Step 3 first.

- [ ] **Step 3: Implement `scripts/fork-service-switch.sh` to this contract**

Write the script to the contract below and let the eight tests drive the rest, then run
`chmod +x scripts/fork-service-switch.sh`. The ordering is the safety property: refuse, then back
up, then switch, then verify, and the restore commands are printed before anything changes.

1. **Arguments** (`set -euo pipefail`). The usage text, printed by `-h`/`--help` (exit 0) and on
   stderr for no mode or an unknown flag (exit 2):
   ```text
   Usage:
     fork-service-switch.sh --to-fork <version> [--archive <file>] [--dry-run] [--health-timeout <s>]
     fork-service-switch.sh --to-official [<version>] [--dry-run] [--health-timeout <s>]

     --to-fork      Install fork release <version> (from the fork's GitHub Release, or --archive)
                    and point t3code.service at it.
     --to-official  Move t3code.service to official release <version>, or the newest nightly.
     --dry-run      Run every check and print the plan; change nothing.
   ```
   `--to-fork` needs a version containing `.fork.`. `--to-official` takes an optional version only
   when the next argument starts with a digit, and refuses one containing `.fork.`. `--archive`
   needs an existing file and goes only with `--to-fork`. `--health-timeout` is whole seconds
   (default 600). Every other failure prints `fork-service-switch: <reason>` on stderr and exits 1.
2. **Refuse from inside the service.** Without `--dry-run`, refuse when `T3_BOOT_SERVICE_UNIT` or
   `T3_SERVICE_LAUNCHER_CONTEXT` is set, with "this shell runs inside the T3 Code service. Run the
   switch from a plain terminal (ssh or a desktop terminal); --dry-run works here." Restarting the
   service from there kills the script halfway. Then require `sqlite3 curl systemctl tar sha256sum`
   on `PATH`.
3. **Read the machine.** The unit is `$HOME/.config/systemd/user/t3code.service`. The T3 home is
   its `Environment=T3CODE_HOME=` value with surrounding quotes stripped, else `$HOME/.t3`. Read
   `activeVersion` from `runtime/service-state.json`, and refuse while that file has
   `"status": "pending"` (an update is in progress). Map `uname -m` `x86_64` to `x64` and
   `aarch64`/`arm64` to `arm64`. All SQLite reads use
   `sqlite3 -batch -init /dev/null -readonly -cmd '.timeout 5000' <db> <sql>`: `-init /dev/null`
   keeps a `~/.sqliterc` from changing the output format.
4. **Refuse busy threads (exit 3).** Print "Refusing to restart t3code.service while these threads
   are busy. Let them finish or stop them, then run this again." and then the rows of:
   ```sql
   SELECT t.title || ' (' || t.thread_id || '): run ' || r.status
     FROM orchestration_v2_projection_runs r JOIN orchestration_v2_projection_threads t USING (thread_id)
     WHERE t.deleted_at IS NULL AND r.status IN ('preparing', 'queued', 'starting', 'running', 'waiting')
   UNION ALL
   SELECT t.title || ' (' || t.thread_id || '): subagent ' || s.status
     FROM orchestration_v2_projection_subagents s JOIN orchestration_v2_projection_threads t USING (thread_id)
     WHERE t.deleted_at IS NULL AND s.status IN ('pending', 'running', 'waiting');
   ```
5. **`--to-official` only: refuse side-chat effects still pending or running (exit 3).** Print
   "Refusing to switch back to an official build while side-chat notes or summaries are still being
   written. Wait for them to finish, then run this again." and then the rows of:
   ```sql
   SELECT thread_id || ': ' || effect_type || ' ' || status FROM orchestration_v2_effect_outbox
     WHERE status IN ('pending', 'running') AND effect_type LIKE 'side-chat.%';
   ```
   An official server's `claimNext` commits `status = 'running'` and only then decodes the row
   (`EffectOutbox.ts:532-566`, `rowToEffect` `:274-295`). The decode fails on an unknown type, the
   worker only logs it (`EffectWorker.ts:855-873`), `reconcileAfterProcessLoss` (`:496-524`) never
   touches the row, and a `running` row blocks every same-lane effect of its thread (`:333-360`). A
   leftover `side-chat.cascade` row on a lesson would block that lesson's `provider-turn.start`
   forever. A note being written has no run, so step 4 misses it.
6. **Print the plan**, five labelled lines: `Service unit:   <unit>`, `T3 home:        <home>`,
   `Running now:    t3 <active>`, `Switching to:   <target, or "the newest official nightly">` and
   `Backup folder:  <home>/backups/fork-switch-<date -u +%Y%m%dT%H%M%SZ>`. With `--dry-run`, print
   `Dry run: nothing changed.` and exit 0.
7. **Back up.** Create the folder. `.backup` the database into it and require
   `PRAGMA quick_check;` to print `ok`. Copy `settings.json` and `keybindings.json` when they exist,
   plus `service-state.json` and the unit. Count the backup's non-deleted threads, print
   `Backed up <n> threads to <folder>.`, then the restore hint, verbatim apart from the paths:
   ```text
   To put the database and settings back as they were before this switch:
     systemctl --user stop t3code.service
     cp '<backup>/statev2.sqlite' '<db>'
     rm -f '<db>-wal' '<db>-shm'
     cp '<backup>/settings.json' '<settings>'
     cp '<backup>/keybindings.json' '<keybindings>'
     <back command>
   ```
   The `settings.json` and `keybindings.json` lines appear only for files that were backed up.
   `<back command>` is `$0 --to-fork <active>` when the active version contains `.fork.`, else
   `$0 --to-official`. Every failure after this point prints the hint again on stderr.
8. **`--to-official` only: drop side-chat keybindings.** When `<home>/userdata/keybindings.json`
   contains `"sideChat.`, rewrite it without the entries whose `command` starts with `sideChat.`,
   keeping the other entries in order. Use the sqlite3 CLI's JSON functions
   (`json_each(readfile(<file>))` filtered on `json_extract(value, '$.command')`, then
   `json_group_array(json(value))`), write to a temp file beside it and `mv` it into place. An
   official server rejects the unknown command as `keybindings.invalid-entry` and then skips its
   startup default sync for good (`apps/server/src/keybindings.ts:479-489`). If the file is not
   strict JSON, die before switching with "remove the sideChat.* entries from <file> by hand, then
   run this again".
9. **Switch through t3 itself.** The launcher starts `runtime/versions/<activeVersion>`, so
   `t3 service install` or `t3 update` must rewrite the unit and the state together.
   - `--to-fork`: skip the install when `runtime/versions/<v>/t3` is executable and its
     `.install-complete` reads `<v>`. Otherwise take `--archive`, or download
     `t3-<v>-linux-<arch>.tar.gz` and `SHA256SUMS` with `curl -fsSL --retry 3` from
     `${T3_FORK_RELEASE_BASE_URL:-https://github.com/aabdel0181/t3code/releases/download}/v<v>/`
     into the backup folder. A downloaded archive's sha256 must equal its `SHA256SUMS` entry, else
     die with `checksum mismatch for <file>; nothing was switched`. Extract with
     `--strip-components=1` into `mktemp -d runtime/versions/.staging-fork-XXXXXX`. Require
     `[[ "$reported" == *"$target"* ]]` for `reported="$(<staging>/t3 --version)"`, the same
     containment check `scripts/smoke-cli-archive.ts:114` makes, because the exact `t3 --version`
     format is not pinned anywhere. Write `.install-complete` (`<v>` and a newline, the
     `pinnedRuntime.ts` sentinel), and `mv` the staging folder to `runtime/versions/<v>`. Then run
     `runtime/versions/<v>/t3 service install --base-dir <home>`.
   - `--to-official`: run
     `env -u T3CODE_RELEASE_BASE_URL runtime/versions/<active>/t3 update <target, or --channel nightly> --base-dir <home> --yes`,
     appending `--allow-downgrade` only when the active version contains `.fork.` and the target
     equals its base nightly `${active%.fork.*}`. Official releases always come from
     pingdotgg/t3code, whatever the shell points the release URL at. Then read the new
     `activeVersion` as the target.
   - A failing `t3` command dies with "t3 service install failed; read its output above before
     running anything else" (or `t3 update failed; …`).
10. **Verify** until `--health-timeout` seconds pass, polling every 2 seconds:
    `server-runtime.json` contains `"serverVersion":"<target>"` and
    `curl -fsS --max-time 5 <its origin>/.well-known/t3/environment` answers with it. On timeout,
    die naming `<home>/userdata/logs/boot-service.log`. Then require
    `systemctl --user is-active --quiet t3code.service`. Then the live thread count must not be
    below the backup's: a thread created between the backup and the stop is not an error. Success
    prints `OK: t3code.service runs t3 <target>; <after> threads (was <before>).`

Notes for the reviewer:
- The fork version sorts after its own base nightly (`compareExactServiceVersions`: when the
  prerelease parts tie, the longer one wins), so `t3 update` refuses the base nightly as a downgrade
  (`update.ts:386-389`). The script passes `--allow-downgrade` for exactly that version, which runs
  on the same migrations, and for nothing else. Until upstream publishes a nightly newer than the
  fork's base, `--to-official` without a version (newest nightly = the base) is refused by
  `t3 update`. Rerun with `--to-official <base nightly>`.
- The thread count only fails when it drops: a thread created between the backup and the stop is
  not an error.

- [ ] **Step 4: Run the tests and check the queries against the real schema**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
vp test run scripts/fork-service-switch.test.ts
bash -n scripts/fork-service-switch.sh && echo syntax-ok
sqlite3 -batch -init /dev/null -readonly .t3/userdata/statev2.sqlite \
  "SELECT count(*) FROM orchestration_v2_projection_runs r JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE t.deleted_at IS NULL AND r.status IN ('preparing','queued','starting','running','waiting'); SELECT count(*) FROM orchestration_v2_projection_subagents s JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE t.deleted_at IS NULL AND s.status IN ('pending','running','waiting'); SELECT count(*) FROM orchestration_v2_effect_outbox WHERE status IN ('pending','running') AND effect_type LIKE 'side-chat.%';"
vp run --filter @t3tools/scripts typecheck && vp lint scripts/fork-service-switch.test.ts
```
Expected: `Tests  8 passed (8)`, then `syntax-ok`. The schema check runs against the worktree's
seeded copy, never `~/.t3`, and prints three integers with no `no such column` or `no such table`
error. Typecheck exits 0, and lint is clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/fork-service-switch.sh scripts/fork-service-switch.test.ts
git commit -m "feat(scripts): switch the background service between fork and official builds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: User docs, fork README, Ideas draft; open the PR into fork `main`

**Files:**
- Create: `docs/user/side-chats.md`
- Modify: `README.md:1` (insert the fork section right after `# T3 Code`)
- Create: `docs/superpowers/upstream-ideas-discussion.md`

**Interfaces:**
- Consumes: the shipped side-chat UI strings, the `sideChat.askSelection` keybinding, and the
  `sideChats` capability (side-chat plan). Also Tasks 7 to 11.
- Produces: the PR `fork/release` into `main` on `aabdel0181/t3code`

- [ ] **Step 1: Read the shipped strings the docs quote**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && grep -rnoE 'Ask in side chat|Shorten selection|Preparing context…|Adding side-chat note…|Side-chat notes included|No note needed|Open side-chat map|Discard|"Done"' apps/web/src/components/sideChat apps/web/src/components/chat/AssistantSelectionToolbar.tsx apps/web/src/components/CommandPalette.tsx | sort -u`
Expected: each phrase used below appears in the shipped code. Where the code spells a label
differently, use the code's exact spelling in the doc.

- [ ] **Step 2: Write `docs/user/side-chats.md`**

~~~markdown
# Side chats

A side chat answers a question about one part of an assistant reply without adding the question to
the conversation. Use it when a reply assumes something you don't know yet: the conversation stays on
its topic, and its AI hears about the detour only if it should teach differently.

Side chats work on web and desktop when the server you're connected to supports them.

## Ask about a highlight

Select text inside one assistant reply and choose **Ask in side chat** next to **Cite**, or press its
shortcut (**Settings → Keybindings**, command `sideChat.askSelection`). The side chat opens in the
right panel beside the conversation, with your selection pinned at the top.

The side chat's AI gets a short summary of the conversation and the passage around your selection,
not the full transcript. It uses the conversation's provider, model, and workspace, answers your
question, and doesn't change files unless you ask. If the summary isn't ready when you send, T3 Code
waits up to about 15 seconds, then sends with a shorter context.

You can't ask about a reply that is still streaming, or about more than 4,000 characters. Asking
again about the same highlight reopens its side chat.

## Go deeper

Select text in a side chat's answer to open a side chat from it. The breadcrumb at the top of the
panel shows the way back. The **Map** tab, also in the command palette as **Open side-chat map**,
shows the conversation and all its side chats as a diagram.

## Finish a side chat

Choose **Done**. The side chat's AI decides whether the conversation's AI should know something, such
as a term you didn't know, and if so writes a one- or two-line note. The note goes with your next
message in the conversation, behind a collapsed **Side-chat notes included** divider. The
conversation doesn't reply on its own.

You don't need to choose Done. Sending a message in the conversation finishes its side chats, except
ones whose AI is still answering, and their notes go with that message. Done also finishes the side
chats opened from that side chat.

A finished side chat shows the note it sent. Send another message in it to continue; choosing Done
again sends only what's new. **Discard**, in the side chat's menu, deletes it without a note. A side
chat you leave without sending anything is removed.

## Where side chats show up

Side chats stay out of the thread list. Text you asked about stays marked in the reply. Click the
small tag at the end of the mark, or the "↳ N side chats" chip under the reply, to reopen its side
chat. Archiving or deleting a conversation does the same to its side chats.

Side chats need this fork on both the app and the server. Official T3 Code apps, including the phone
app, show side chats as ordinary threads.
~~~

- [ ] **Step 3: Insert the fork section into `README.md` after line 1**

~~~markdown

## This fork

This fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) adds
[side chats](docs/user/side-chats.md). Its builds never update themselves: the desktop auto-updater,
server self-update and the update button's server updates are off. Side chats need the fork on both
the app and the server, from the same release.

### Install the Mac app

1. Download it: `gh release download --repo aabdel0181/t3code --pattern 'T3-Code-*-arm64.dmg'`, or
   use the [Releases](https://github.com/aabdel0181/t3code/releases) page.
2. Quit T3 Code, open the dmg, and drag T3 Code into Applications. Move any other T3 Code app to the
   Trash so only one app uses your data. Your settings and connections stay.
3. The app is not signed. If macOS won't open it, run
   `xattr -dr com.apple.quarantine "/Applications/T3 Code (Beta).app"`, or allow it under
   **System Settings → Privacy & Security**.

### Switch the Ubuntu server

Run this from a plain terminal (ssh or a desktop terminal), never from a T3 Code thread or terminal:
restarting the server ends every session it hosts.

```sh
sudo apt-get install -y sqlite3                     # once
cd ~/.t3/projects/t3-sidechat && git pull --ff-only
scripts/fork-service-switch.sh --to-fork <version> --dry-run
scripts/fork-service-switch.sh --to-fork <version>
```

`<version>` is the release name without the `v`, for example
`0.1.2-nightly.20261022.3541.fork.9`. The script refuses while any thread is running, queued, or has
a running workflow. It backs up `statev2.sqlite`, `settings.json` and `keybindings.json` to
`~/.t3/backups/fork-switch-<time>/`, switches, checks that the new server answers with that version
and that no threads are missing, and prints the commands that restore the backup.

To go back to an official release, run `scripts/fork-service-switch.sh --to-official` for the newest
nightly, or pass a version. The official version must be the fork's base nightly (the part before
`.fork.`, for example `0.1.2-nightly.20261022.3541`) or newer. Until upstream publishes a nightly
newer than the fork's base, the newest nightly *is* the base and `t3 update` refuses it as a
downgrade, so roll back with `--to-official <base nightly>`. Going back also refuses while a
side-chat note or summary is still being written (an official server cannot finish it and would get
stuck on it); wait a moment and run it again. It removes `sideChat.*` shortcuts from
`keybindings.json`, which an official server would reject. The fork's server removes unused official
runtimes when it starts, so going back downloads the official release again.

### Update the fork

```sh
git fetch upstream --tags
git switch main && git pull --ff-only origin main
git rebase upstream/main
git push --force-with-lease origin main
gh workflow run fork-release.yml --repo aabdel0181/t3code --ref main -f version="$(scripts/fork-version.sh origin/main)"
```

When the run finishes, install the new Mac app and run `--to-fork` with the new version. A fork must
be at or ahead of the official version the server last ran; otherwise the switch refuses.
~~~

- [ ] **Step 4: Write `docs/superpowers/upstream-ideas-discussion.md`**

~~~markdown
# Upstream Ideas discussion draft

Post in https://github.com/pingdotgg/t3code/discussions/categories/ideas after med has used side
chats daily for two weeks (PRD §5). Before posting, replace DEMO_URL with the demo video's link.

---

**Title:** Side chats: ask about a highlighted passage without derailing the conversation

### The problem

When I learn something new with an agent (most recently reinforcement-learning environments), its
replies assume knowledge I don't have yet. Each clarifying question goes into the same conversation,
each answer assumes something else, and after a few rounds neither of us knows where the lesson
stopped. The agent starts treating the clarifications as the topic.

**Cite** puts the quote into the same conversation, which is the path that derails it. **Fork**
copies the whole conversation into a separate thread, and **Merge back** replays up to about 16k of
it into the parent. Neither keeps the lesson clean, and neither is at hand at the moment of confusion.

### The idea

Select text in a reply and choose **Ask in side chat**, next to Cite. A side chat opens in the right
panel with the highlight pinned. Its agent starts from a short summary of the conversation plus the
highlight, not the transcript. Side chats can nest, and a Map tab shows the tree.

When you finish (Done, or simply your next message in the conversation), the side chat's agent
writes a one- or two-line note only if the main agent should teach differently ("they didn't know
what an observation space is"). The note rides along with your next message as context, behind a
collapsed divider. The conversation never replies on its own and never sees side-chat traffic.

Demo: DEMO_URL

### How it fits T3 Code

- Server: two commands (`thread.side_chat.open`, `thread.side_chat.done`) and a side-chat field on
  threads. Summaries and notes are written in the background, on the same text-generation lane as
  thread titles. Each delivery is one context handoff. No SQL migration, no new literal in an
  existing union, and no context transfers, so an official server reading the same database sees
  ordinary threads.
- Clients: gated on a `sideChats` capability. Older clients, including the phone app, show side
  chats as ordinary threads.
- Every provider works. Summaries and notes use the conversation's own provider and its small text
  model.

I built it in a fork ([aabdel0181/t3code](https://github.com/aabdel0181/t3code)) for web and
desktop and have used it every day for two weeks.

### Questions

1. Is this a direction you'd take for T3 Code?
2. If so, should a first PR include mobile and MCP tools for agents, or start with web and desktop?
3. Is the right panel the right home for it?
~~~

- [ ] **Step 5: Check formatting and commit**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp fmt --check docs/user/side-chats.md README.md docs/superpowers/upstream-ideas-discussion.md`
Expected: no diff (run `vp fmt` on the three files if there is one).
```bash
git add docs/user/side-chats.md README.md docs/superpowers/upstream-ideas-discussion.md
git commit -m "docs: side chats guide, fork install and server switch, upstream Ideas draft" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Run CI's fast checks for the branch**

Run: `cd /home/quokka/.t3/projects/t3-sidechat-dev && vp run check:changed origin/main`
Expected: every listed check passes (format, lint, knip, typecheck of shared, desktop, t3, web and
scripts, plus the tests beside the changed files). Fix and amend before pushing.

- [ ] **Step 7: Push and open the PR into fork `main`**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
git push -u origin fork/release
gh pr create --repo aabdel0181/t3code --base main --head fork/release \
  --title "feat: fork release plumbing (no self-update, Mac build, server switch)" \
  --body-file - <<'EOF'
med runs side chats day to day from a Mac build of this fork, connected to an Ubuntu server that runs the fork too. Both must come from one commit and must never be replaced by an official release.

- Fork builds never update themselves. The desktop updater reports "off in this fork build". The server advertises no self-update and refuses update requests. "Update everything" skips server updates. One define, `__T3CODE_FORK_BUILD__`, is set only in bundles built with `T3CODE_FORK_RELEASE=1`, which only `fork-release.yml` sets, so dev and upstream builds are unaffected (`packages/shared/src/forkBuild.ts`). Tests turn it on through `T3CODE_FORK_BUILD`.
- `.github/workflows/fork-release.yml` builds the unsigned arm64 dmg and the Linux x64 server runtime from one commit, and publishes both with `SHA256SUMS` to release `v<version>`. `scripts/fork-version.sh` names versions `<base nightly>.fork.<n>`, which sort after the nightly they contain.
- `scripts/fork-service-switch.sh` switches `t3code.service`. It refuses while threads are busy (and, going back to official, while a `side-chat.*` effect an official server cannot decode is pending or running), takes an online SQLite backup, hands the switch to `t3 service install` or `t3 update` (the launcher reads `service-state.json`, not only `ExecStart`), then checks health and the thread count. Going back it drops `sideChat.*` keybindings and allows exactly one downgrade, to the fork's base nightly. It is tested with a fake HOME and a fake systemctl.
- Docs: `docs/user/side-chats.md`, README "This fork", and the upstream Ideas draft.

Tests: `vp test run apps/desktop/src/updates/DesktopUpdates.test.ts apps/server/src/cloud/selfUpdate.test.ts apps/server/src/environment/ServerEnvironment.test.ts apps/web/src/components/sidebar/updateEverything.logic.test.ts scripts/fork-service-switch.test.ts`, plus `vp run check:changed origin/main`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```
Expected: a PR URL. Register it with the thread (`link_pull_request`). Ask med to review it and
squash-merge it. Squash merges keep fork `main` linear, so "Update the fork" can rebase it.

### Task 13: Cut the first fork release and hand the install and switch to med

**Files:** none

**Interfaces:**
- Consumes: the merged PR (Tasks 7 to 12) on fork `main`
- Produces: GitHub Release `v<version>` on `aabdel0181/t3code` with three assets; med's Mac and
  Ubuntu server on that release

- [ ] **Step 1: Compute the version from the merged `main`**

Run:
```bash
cd /home/quokka/.t3/projects/t3-sidechat-dev
git fetch origin
VERSION="$(scripts/fork-version.sh origin/main)"; echo "$VERSION"
git -C /home/quokka/.t3/projects/t3-sidechat pull --ff-only origin main
```
Expected: `0.1.2-nightly.20261022.3541.fork.<n>`, then a fast-forward of the main checkout, which
is where med runs the switch script.

- [ ] **Step 2: Turn Actions on with only the fork workflow enabled**

Actions have been off for the whole repository since Task 1 Step 4. Do this step with no push and
no PR activity on the fork in between: `ci.yml` also triggers on `pull_request` and `push: main`.

Run:
```bash
gh api -X PUT repos/aabdel0181/t3code/actions/permissions -F enabled=true -f allowed_actions=all
gh api repos/aabdel0181/t3code/actions/workflows --paginate \
  --jq '.workflows[] | select(.path != ".github/workflows/fork-release.yml" and .state == "active") | .path' \
  | while read -r path; do gh workflow disable "$path" -R aabdel0181/t3code; done
gh workflow enable fork-release.yml -R aabdel0181/t3code
gh api repos/aabdel0181/t3code/actions/workflows --paginate --jq '.workflows[] | "\(.state)\t\(.path)"' | sort
```
Expected: the last command lists 19 rows (the 18 upstream workflow files and
`fork-release.yml`): `.github/workflows/fork-release.yml` is `active` and every other row is
`disabled_manually`. If the list is empty or lacks `fork-release.yml`, GitHub has not registered the
workflow files: turn Actions off again
(`gh api -X PUT repos/aabdel0181/t3code/actions/permissions -F enabled=false`) and ask med before
going on. Also confirm nothing started: `gh run list -R aabdel0181/t3code --limit 5 --json databaseId --jq length`
prints `0`.

- [ ] **Step 3: Run the release**

Run:
```bash
gh workflow run fork-release.yml -R aabdel0181/t3code --ref main -f version="$VERSION"
gh run list -R aabdel0181/t3code --workflow fork-release.yml --limit 1 --json databaseId,status --jq '.[0]'
```
Then run `gh run watch <databaseId> -R aabdel0181/t3code --exit-status` with the Bash tool's
`run_in_background` (the macOS job takes about 30 minutes).
Expected: `✓ Created workflow_dispatch event`, then the run completes with success. On failure,
read `gh run view <id> -R aabdel0181/t3code --log-failed`, fix it on a branch through a PR, and
rerun with a new version (`.fork.<n>` grows with each commit).

- [ ] **Step 4: Verify the release assets**

Run: `gh release view "v$VERSION" -R aabdel0181/t3code --json assets --jq '[.assets[].name] | sort | .[]'`
Expected: exactly `SHA256SUMS`, `T3-Code-$VERSION-arm64.dmg` and `t3-$VERSION-linux-x64.tar.gz`.

- [ ] **Step 5: Hand off to med (the agent stops here)**

Send med these steps, with `$VERSION` filled in. **Do not run any of them yourself.**
1. Mac: follow README "This fork → Install the Mac app". Check **Settings** for the update status
   "Automatic updates are off in this fork build. Rebuild the fork to update.", and check that
   About shows `$VERSION`.
2. Ubuntu, from a plain ssh or desktop terminal:
   `cd ~/.t3/projects/t3-sidechat && scripts/fork-service-switch.sh --to-fork $VERSION --dry-run`.
   If that lists busy threads ("Audit AI PCB Eval Verdicts" included), wait for them. Then run it
   without `--dry-run`.
3. Confirm the switch:
   `curl -fsS "$(sed -n 's/.*"origin":"\([^"]*\)".*/\1/p' ~/.t3/userdata/server-runtime.json)/.well-known/t3/environment" | grep -o '"sideChats":true'`
   prints `"sideChats":true`. Then open a lesson on the Mac and try **Ask in side chat**.
4. To roll back: `scripts/fork-service-switch.sh --to-official <base nightly>`, where the base
   nightly is `$VERSION` without its `.fork.<n>` suffix, until upstream publishes a newer nightly
   (after that, plain `--to-official` works). It refuses while a side-chat note or summary is still
   being written; wait and run it again. The restore commands it printed bring back the pre-switch
   database.
