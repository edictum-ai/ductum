# Bootstrap-Redesign Arc — Audit Findings

**Authored:** 2026-05-05 (driven by Claude Opus 4.7 against
`ductum@0.1.1`).

**Driven against:** the Lima VM at
`macmini-1.sunrise.box:.lima/p5-exit-demo/` set up for the P5 run.
Not strictly fresh — the VM has been through cycles of install /
uninstall / clean during D159 + D160 + D161 work — but the
non-init UX surfaces (dashboard CRUD, settings) are state-agnostic
and reflect the published 0.1.1 build. CLI install paths re-tested
in isolated `/tmp/npm-test-ductum/`.

**Scope reminder (D161):** capture the full debt of 0.1.1's shipped
surface before deciding remediation. Do not fix while auditing. Each
form / default / settings field gets its own line.

## Section 1 — Bootstrap install path

### 1.1 `pnpm install -g ductum@0.1.1`
- **Verdict:** `partial`
- **Evidence:** Verified live on VM during P5 run (commit `2def924`,
  D160 §Verification). `pnpm install -g ductum@0.1.1` warns:
  `Ignored build scripts: better-sqlite3@11.10.0. Run "pnpm
  approve-builds -g" to pick which dependencies should be allowed
  to run scripts.` Binding never built; API fails to load native
  module at startup.
- **Workaround verified:** `pnpm install -g --allow-build=better-sqlite3
  ductum@0.1.1` builds the binding in ~84ms; API loads.
- **Recommended remediation scope:** **own-arc** if we want true
  zero-flag pnpm install (probably requires shipping a
  `postinstall` in ductum's own manifest, which has its own pnpm-10
  script-policy implications and may not work for global installs
  at all). **next-bundle** if we accept documenting the flag in
  README + harness, because the protocol's "single command" no
  longer matches the documented `pnpm install -g ductum`.
- **Notes:** D160 fixed this for the P5 demo harness. End users
  hitting `pnpm install -g ductum` from docs / npm page will hit
  this same wall and get a non-functional install. README and `npm
  view`-discoverable docs need updating regardless of which fix
  ships.

### 1.2 `npm install -g ductum@0.1.1`
- **Verdict:** `works`
- **Evidence:** Test install at `/tmp/npm-test-ductum/` on the VM
  succeeded in 22s; better-sqlite3 binding present at
  `node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
  `npm install` runs install scripts by default, so the native
  build kicks off automatically.
- **Recommended remediation scope:** none. npm path works as
  expected.
- **Notes:** This is the gentler install path. Doc copy that
  recommends pnpm without flagging the `--allow-build` requirement
  is misleading — the npm path is currently more reliable for end
  users.

### 1.3 Tarball contents
- **Verdict:** `works`
- **Evidence:** package.json `files` field declares `["dist",
  "assets", "README.md", "LICENSE"]`. Per npm publish notice during
  the 0.1.1 publish (commit `1a8410d` in conversation, P4 evidence):
  394 files, 836.3 kB compressed, including
  `assets/specs/examples/hello-readme/{README.md, P1-HELLO-README.md}`.
- **Recommended remediation scope:** none.
- **Notes:** No source maps in the tarball (intentional). No tests
  or fixtures.

## Section 2 — `ductum init` TUI happy path

All evidence from the live runs on 2026-05-05 (multiple iterations
through the TUI; pane captures in
`evidence/p5-blocker2-pane.txt` and the full P5 ladder).

### 2.1 Welcome screen renders
- **Verdict:** `works`
- **Evidence:** Pane captured `┌ ductum init │ ◇ Welcome ...
  Create a local factory directory with a minimal ductum.yaml.
  ◆ Press Enter to continue`.

### 2.2 Directory prompt
- **Verdict:** `works`
- **Evidence:** Default `~/ductum` accepted on Enter. Existing
  factory dir rejection NOT directly tested in this run (re-running
  init in same dir would have surfaced the `init_already_initialized`
  branch but we wiped between runs). Path validation appears to
  function — no crashes on default path.
- **Notes:** `init_already_initialized` error path is
  documented in P0 spec but not directly exercised in this audit.
  Worth covering in a future regression test.

### 2.3 Project name prompt
- **Verdict:** `works`
- **Evidence:** Default `factory` accepted on Enter; YAML preview
  reflected the name correctly.

### 2.4 Confirm scaffold
- **Verdict:** `works`
- **Evidence:** Confirm screen showed correct yaml preview (factory
  block, projects, agents:[], harnesses:[], etc.). Default selection
  is `No` (filled circle on No), requiring Left to switch to Yes.
  This default-to-No is a defensible cautious choice (don't
  scaffold by accident) but the confirmation copy is dense — the
  user has to read the whole yaml before deciding.
- **Notes:** Defensible default; flag for usability later if
  operators report friction.

### 2.5 Anthropic auth (PKCE)
- **Verdict:** `works`
- **Evidence:** PKCE flow runs end-to-end (3 successful runs in
  the P5 attempts); `~/.claude/.credentials.json` written with
  `{claudeAiOauth: {accessToken, expiresAt, refreshToken}}` shape.
  Listener bound to `127.0.0.1:53692` as expected. Callback
  exchange completed in <2s after operator clicks approve.
- **Notes:** PKCE itself is solid. The credentials *format* it
  writes is the bug surfaced separately (#7 — see Section 11).

### 2.6 Codex auth — skip path
- **Verdict:** `works`
- **Evidence:** Default-No prompt; Enter accepts and prints "Codex
  auth skipped" with a hint to run `codex login` later.

### 2.7 Codex auth — acquisition path
- **Verdict:** `not-tested`
- **Evidence:** Operator-personal acquisition wasn't exercised
  during this audit (skip path was the protocol's documented
  choice).
- **Recommended remediation scope:** part of own-arc (see
  Section 5/8 dashboard UX) — needs a fresh OpenAI account or test
  account to verify.

### 2.8 Copilot auth — skip path
- **Verdict:** `works`
- **Evidence:** Default-No prompt; Enter accepts and prints
  "Copilot auth skipped."

### 2.9 Copilot auth — acquisition path
- **Verdict:** `not-tested`
- **Evidence:** Operator-personal acquisition not exercised in
  this audit.
- **Recommended remediation scope:** verify in next run when a
  test GitHub account exists.

### 2.10 Agent picker
- **Verdict:** `works`
- **Evidence:** Multi-select with claude-builder pre-selected (only
  one available since Codex/Copilot skipped). Enter confirms.
- **Notes:** Behavior with multiple providers selected not
  exercised in this audit; the picker only rendered one option.

### 2.11 Scaffold step
- **Verdict:** `works`
- **Evidence:** Pane showed `Scaffolded: directory:
  /home/.../ductum/factory; files: ductum.yaml, .gitignore,
  .ductum/; git: initial commit created`. Verified on disk: 4 files
  + `.git` + `.ductum` subdir.

### 2.12 API start
- **Verdict:** `works (post-D159)`
- **Evidence:** Pane showed `Ductum API is running` and bound to
  `127.0.0.1:49021` (within forwarded port range). Failed before
  D159; works after the credentials.json reading fix.

### 2.13 Dashboard URL surfaced
- **Verdict:** `broken`
- **Evidence:** Pane captured `Dashboard ─ API:
  http://127.0.0.1:49021 │ Open this URL within 60 seconds:
  http://127.0.0.1:49021/welcome?token=undefined`. Token is the
  literal string "undefined" rather than the operator token (which
  exists at `.env.local` as `DUCTUM_OPERATOR_TOKEN=I5YIvm_...`).
- **Recommended remediation scope:** `inline-fix`. The bug is
  almost certainly in `init/steps/browser-handoff.ts` — the token
  variable is read before being assigned, or from the wrong
  source.
- **Notes:** This is an obvious foot-gun. End users get a URL that
  says `?token=undefined` and won't authenticate. Without an
  operator who knows to grep `.env.local`, the demo is dead at
  this step. Severity: blocker for any honest first-run flow.

## Section 3 — `ductum init` TUI failure paths

Audited primarily by code + test inspection (not full re-runs of
each path). Tests exist for the structured error shapes; live
behavior on cancel paths verified via the live runs.

### 3.1 Re-running init in an existing factory dir
- **Verdict:** `works (per tests)`
- **Evidence:** `packages/cli/src/tests/init/paths.test.ts` — `it('rejects an existing ductum.yaml with a start suggestion')`. Code at `packages/cli/src/init/paths.ts:101` emits `init_already_initialized` with `suggestedActions[0].cmd = "ductum start --dir <path>"`.
- **Notes:** Not directly re-tested live in this audit; passes its unit test.

### 3.2 Cancelling at each prompt with Ctrl+C
- **Verdict:** `partial`
- **Evidence:** `init/sigint.ts` wires AbortController-based cancellation that throws `initCancelledError(reason='sigint')`. PKCE step has explicit cancel test (`auth-anthropic.test.ts: emits sigint auth failure and closes the callback server on abort`). Scaffolder rollback on SIGINT is not covered by an automated test; depends on `init/steps/scaffold.ts` to roll back (review showed roll-back logic exists but isn't unit-pinned).
- **Recommended remediation scope:** `next-bundle` — add scaffolder rollback regression test.
- **Notes:** P0 spec required SIGINT mid-scaffold to roll back the partial dir creation. Code looks plausible but uncovered by tests.

### 3.3 PKCE callback timeout
- **Verdict:** `works`
- **Evidence:** `auth-anthropic.test.ts: maps callback timeouts to a structured init auth error`.

### 3.4 PKCE callback port collision
- **Verdict:** `works`
- **Evidence:** `auth-anthropic.test.ts: maps callback port collisions to a structured init auth error`.

### 3.5 Invalid project name
- **Verdict:** `works`
- **Evidence:** `paths.test.ts: accepts only slug project names`. Code at `paths.ts:50` emits `init_invalid_project_name`.

### 3.6 Unwritable directory
- **Verdict:** `works`
- **Evidence:** `paths.test.ts: rejects a non-directory path as unwritable`. Code at `paths.ts:84` emits `init_path_unwritable`.

### 3.7 Existing git repo with uncommitted changes
- **Verdict:** `works`
- **Evidence:** `paths.test.ts: rejects a git repo with uncommitted changes`. Code at `paths.ts:122` emits `init_git_uncommitted`.

### 3.8 Live regression observation: Enter during PKCE wait
- **Verdict:** `broken`
- **Evidence:** During the live driving of the harness, sending Enter keystrokes to the tmux session while the PKCE spinner was active caused the auth step to fail with "Claude authentication failed" — even though the PKCE callback hadn't yet arrived. The keystrokes appear to have been interpreted as cancel by `@clack/prompts`'s spinner handler.
- **Recommended remediation scope:** `inline-fix`. The spinner during PKCE wait should ignore unrelated keystrokes (only Ctrl+C should cancel).
- **Notes:** This is an *automation-fragility* finding. End operators won't typically slam Enter during a wait; harness-driven runs and accidentally-typed input both will. Worth hardening.


## Section 4 — Dashboard `/welcome` route

Visually inspected via chrome-devtools against the running 0.1.1 API.
Screenshots in `evidence/audit/01-welcome-loaded.png`.

### 4.1 Route loads with valid handoff token
- **Verdict:** `partial`
- **Evidence:** `POST /api/welcome/handoff` mints a 60s handoff token. Page loads at `/welcome?token=<handoff>`. Page renders factory name, agents, sample-import button. **Console errors:** two `410 Gone` from the SPA exchanging the handoff token *twice* — likely React StrictMode or effect re-fire; first exchange consumes it, second hits 410.
- **Recommended remediation scope:** `inline-fix`. Idempotency key on the exchange, OR debounce on the SPA side.

### 4.2 Route handles `?token=undefined`
- **Verdict:** `broken`
- **Evidence:** This is the failure shape `ductum init` actually produces (#3 / Section 2.13). The SPA's `/welcome` page receives the literal string "undefined" as token, attempts handoff exchange (fails), then renders an unauthenticated UI. No clear error message is displayed to the user — they see a half-broken dashboard and don't know why. **Combined with #2.13, this means the documented init→browser→dashboard handoff is end-to-end broken on a fresh install.**
- **Recommended remediation scope:** `inline-fix`. Fix #2.13 at source. Also: SPA should detect the literal "undefined" / "null" string token and show a "session expired, run `ductum init` again or paste your operator token" page rather than a half-loaded dashboard.

### 4.3 Token-to-cookie exchange + URL strip
- **Verdict:** `partial`
- **Evidence:** Backend at `POST /api/internal/welcome/exchange` correctly sets `Set-Cookie: ductum_operator_token=...`. URL strip on first load: not directly verified in this run, but the React app navigates and the URL appears clean post-load. The double-exchange issue (4.1) means the second attempt hits 410 — UX cost is one console error per page load, no functional break.
- **Notes:** The redirect-URI-with-token-in-query pattern is documented in D149 as a known short-lived handoff. Acceptable but the SPA should consume the token cleanly.

### 4.4 "Import your first spec" UI (file upload)
- **Verdict:** `not-tested`
- **Evidence:** Did not exercise file upload during this audit.
- **Recommended remediation scope:** include in next audit pass.

### 4.5 "Create Sample" / sample task button
- **Verdict:** `partial`
- **Evidence:** Live click during P5 produced no visible UI feedback — operator reported "nothing." API endpoint `/api/welcome/sample-spec` works (verified via curl: returns 200 with hello-readme content). API import endpoint `/api/projects/<id>/specs/import` also works (verified via curl: returns spec record with taskCount: 1). So the bug is between the React mutation and the user — likely silent failure mode (mutation isError state present but not rendered; or onClick handler not bound on first render).
- **Recommended remediation scope:** `inline-fix`. Check `useSampleSpecMutation` error rendering.

### 4.6 SSE event stream rendering
- **Verdict:** `not-tested`
- **Evidence:** Console showed initial "offline" status briefly during the P5 attempt. After the page settles, status indicator showed "connected" on the agents page. Did not specifically watch the SSE stream during a live run on this audit.

## Section 5 — Dashboard agent CRUD

Visually inspected via chrome-devtools. Screenshots:
`evidence/audit/02-agents-page.png`,
`evidence/audit/03-model-picker-open.png`,
`evidence/audit/04-add-agent-clicked.png`.

### 5.1 Add new agent
- **Verdict:** `broken`
- **Evidence:** Clicking "Add agent" creates an agent with auto-name `agent-N` and **Codex defaults**: `model: "gpt-5.4", harness: "codex-sdk", capabilities: ["build","test","fix","review"], effort: "xhigh", costTier: 80`. On a factory where only Anthropic is configured (P5's documented setup), this default produces an immediately-broken agent the user has to manually re-pick model + harness for. The default should be `claude-builder`-shaped given that's what `ductum init` configures.
- **Recommended remediation scope:** `inline-fix`. `addAgent()` in `AgentConfigPanel.tsx` should pick defaults based on which providers are actually authenticated, or default to the same shape `ductum init` uses.

### 5.2 Agent name is not editable in UI
- **Verdict:** `broken`
- **Evidence:** Inspected source (`AgentConfigPanel.tsx:184`) and DOM (snapshot uid=1_79, uid=1_114) — agent name renders as static text only. There is no rename input in the UI. Once an agent is added with the auto-generated name, the only way to rename is to hand-edit the YAML or settings config endpoint.
- **Recommended remediation scope:** `next-bundle`. Add an inline rename input. Otherwise the auto-generated `agent-1`, `agent-2`, ... names persist forever and dashboards full of `agent-N` are unreadable.

### 5.3 First agent literally named "0"
- **Verdict:** `broken`
- **Evidence:** API `/api/settings/config` returns `agents: { "0": {...}, "agent-2": {...} }`. The first agent's key is the literal string `"0"`. The dashboard displays this as the agent name. The user reported this is what they got after some interaction with the form — possibly the rename UI (if it ever existed) accepted the empty/numeric name, or a bug coerced the index to a key. This is consistent with the user's "weird name" complaint.
- **Recommended remediation scope:** `inline-fix`. Reproduce the path that names an agent "0", fix the validation. Validate non-empty / slug-shaped names on save.

### 5.4 Phantom "0" harness in picker
- **Verdict:** `broken`
- **Evidence:** Harness select shows options `["Claude Agent SDK", "Codex SDK", "Codex app-server", "0"]` (DOM snapshot uid=1_84-1_87). The "0" comes from the `config.harnesses` map having a key named "0" (mirrors §5.3 — bad name leaked into the harness registry too). It's also `disabled: false` and selectable. The user can pick a literal "0" harness which then fails downstream.
- **Recommended remediation scope:** `inline-fix`. Same root cause as §5.3.

### 5.5 Workforce count ≠ config count
- **Verdict:** `broken`
- **Evidence:** The "WORKFORCE" widget at top displays `1 agents` and shows only `claude-builder`. The config below shows TWO agents (`0` and `agent-2`). Two reasons emerged on inspection:
  1. Workforce filters by project-pool membership; agents not assigned to any project don't display.
  2. The `claude-builder` shown in workforce comes from a different source (project-agent join) than the agents-config card (which reads YAML).
  The user has no obvious way to reconcile these two views or to assign newly-added agents to a project.
- **Recommended remediation scope:** `next-bundle`. Either show all configured agents in the workforce widget (with badges for unassigned), or surface a clear "Assign to project" affordance inline next to each unassigned agent.

### 5.6 Model picker (the actual picker)
- **Verdict:** `works`
- **Evidence:** Click "model" cell opens a search-able popover with provider icons, model labels, version IDs, subscription badges, side-panel with Speed/Intelligence bars, Provider, Context, Recommended use, Supports list, and link to "official source". 11 models in catalog (3 Anthropic, 8 Z.AI). Opus 4.7, Sonnet 4.6, Opus 4.6 all present with `Claude Code subscription` badge. UX is solid.
- **Notes:** The picker itself is not what the user complained about. The complaint was the *defaults* on add (§5.1) and the *agent name* (§5.2-5.3).

### 5.7 Harness picker
- **Verdict:** `partial`
- **Evidence:** Native `<select>` with 4-5 options including the phantom "0" (§5.4). Pi appears as a disabled option `Pi (blocked, see D52)`. UX is functional but minimal compared to ModelPicker.

### 5.8 Effort picker
- **Verdict:** `works`
- **Evidence:** Native `<select>` with `Low/Medium/High/xHigh/Max`. Filtered by selected model's supportedEfforts. When `usesModelRef` (resource-backed), falls back to a freeform text input.

### 5.9 Capabilities picker
- **Verdict:** `works`
- **Evidence:** Toggle buttons for `Build / Test / Fix / Review / Docs / Quick fix`, multi-select, with hover hints.

### 5.10 Routing tier
- **Verdict:** `works`
- **Evidence:** Numeric input. Hint: "Relative routing score..." Solid.

### 5.11 Save agents button
- **Verdict:** `not-tested`
- **Evidence:** Did not exercise save during this audit. Per code, calls API to persist the modified config.

### 5.12 Edit existing agent
- **Verdict:** `partial`
- **Evidence:** Existing agents render with their stored values. No way to rename (§5.2). All other field changes appear to round-trip via the config endpoint.

### 5.13 Delete agent
- **Verdict:** `not-shipped`
- **Evidence:** No delete button visible in the agent editor. To remove an agent, the operator must hand-edit the YAML config.
- **Recommended remediation scope:** `next-bundle`. Add a delete affordance per agent row.

## Section 8 — Dashboard settings menu

Visually inspected via chrome-devtools. Screenshot:
`evidence/audit/05-settings-page.png`.

### 8.1 "Operator token required" banner
- **Verdict:** `broken`
- **Evidence:** Big yellow banner "Operator token required — Set DUCTUM_OPERATOR_TOKEN in .env.local or ~/.ductum/operator-token. Auto-detect works only when the local API was started with explicit opt-in." displayed *on every page* (welcome, agents, settings, etc.) **despite the SPA being authenticated and rendering live data**. The banner has "Auto-detect" and "Dismiss" buttons. The condition for showing this banner is wrong — it fires when authenticated.
- **Recommended remediation scope:** `inline-fix`. Find the auth-probe state and only render this banner when token is actually missing.

### 8.2 Factory `name` field
- **Verdict:** `partial`
- **Evidence:** Reads `factory.name` from the config YAML. Renders correctly with current value. Save round-trip not verified.

### 8.3 Factory `merge mode` field
- **Verdict:** `broken`
- **Evidence:** Form reads `factory.mergeMode` with fallback to `'human'`. Actual API stores merge mode at `factory.config.defaultMergeMode`. The dropdown always shows "human" because the read-path is wrong; the fallback masks the bug. Editing won't persist correctly either (write-path also goes to wrong field).
- **Recommended remediation scope:** `inline-fix`. Align the form's read/write path with the API's stored shape.

### 8.4 Factory `heartbeat seconds` field
- **Verdict:** `broken`
- **Evidence:** Form reads `factory.heartbeatTimeout`. API stores `factory.config.heartbeatTimeoutSeconds`. Field renders empty even when API has `120` configured. Same root cause as §8.3.
- **Recommended remediation scope:** `inline-fix`.

### 8.5 Factory `API port` field
- **Verdict:** `broken`
- **Evidence:** Form reads `config.port` (top level of the DuctumConfig type). The actual port is dynamic per `init/steps/api-process.ts:findFreeLoopbackPort()` — bound at runtime, not stored in config. Field renders empty.
- **Recommended remediation scope:** `next-bundle`. Either store the runtime-bound port in the factory config and surface it here, or remove this field (it's misleading because port assignment isn't user-controlled).

### 8.6 Factory `dashboard port` field
- **Verdict:** `broken`
- **Evidence:** Same as §8.5 — reads `config.dashboard`, no such field stored. Empty in UI.

### 8.7 Factory `merge base` field
- **Verdict:** `broken`
- **Evidence:** Reads `factory.merge.base`. No such default in the scaffolded yaml. Empty.

### 8.8 Factory `merge strategy` field
- **Verdict:** `partial`
- **Evidence:** Reads `factory.merge.strategy` with fallback to 'merge'. Always shows "merge" because no value is stored. Save round-trip not verified.

### 8.9 Factory `push merges` checkbox
- **Verdict:** `partial`
- **Evidence:** Checkbox bound to `factory.merge.push`. Defaults to false. No value stored — checkbox always unchecked.

### 8.10 Budget fields (warn/run, hard/run, hard/spec USD)
- **Verdict:** `broken`
- **Evidence:** Read `factory.costBudget.{perRunWarnUsd, perRunHardUsd, perSpecHardUsd}`. Budget fields exist in D114/D118 conventions but are stored in run-level state, not factory config — these UI fields show empty and likely don't persist usefully.

### 8.11 Worktrees enabled checkbox
- **Verdict:** `partial`
- **Evidence:** Reads `factory.worktrees.enabled`. Defaults to true (`!== false` check). Always shows checked. Toggle write-path not verified.

### 8.12 Workflow observer mode checkbox
- **Verdict:** `partial`
- **Evidence:** Same shape as §8.11.

### 8.13 Telegram approvals section
- **Verdict:** `not-tested`
- **Evidence:** Buttons present (Discover chat id, Test send, Add Telegram channel, etc.). Did not exercise during this audit.

### 8.14 API access / operator token section
- **Verdict:** `partial`
- **Evidence:** Shows "Open" (green dot), operator-token input field, Verify token / Clear / Save token buttons. Functional surface; specific persistence behavior not verified.

### 8.15 Save / Saved indicator
- **Verdict:** `partial`
- **Evidence:** Top-right shows "Saved" badge after page loads. Top-right "Save" button is present. Does NOT autosave on field changes (per source: explicit save button required). The "Saved" badge despite settings clearly broken (§8.3-8.10) is misleading — it shows saved-state for the YAML round-trip, not for whether the form actually reflects reality.

## Section 6 — Dashboard project CRUD

Inspected via `/factory` route + API.
Screenshot: `evidence/audit/07-factory-detail.png`.

### 6.1 Add project
- **Verdict:** `not-tested`
- **Evidence:** "+ New Spec" / "Import Spec" buttons present on the project detail page; no visible "Add project" button on any page traversed in this audit. Multi-project flow not exercised — `ductum init` scaffolds exactly one project. Adding a new project likely requires hand-editing `ductum.yaml`.
- **Recommended remediation scope:** `next-bundle`. Project CRUD is a multi-project case the arc didn't cover; document or add UI.

### 6.2 Project detail rendering
- **Verdict:** `works`
- **Evidence:** `/factory` route renders the project header (factory name, SPECS/RUNS/FAILED/SPEND counts), HISTORY (1 SPEC) listing `hello-readme` with `1 task · 1 failed`, the stalled `append-readme-line` task, AGENTS (1) with `claude-builder` summary. Visual content matches API state.

### 6.3 Project assignments to agents
- **Verdict:** `not-tested`
- **Evidence:** AGENTS section on project detail shows assigned agents (just `claude-builder` here). UI for *changing* assignments not visible on this page; likely lives in agents page (where the §5.5 mismatch lives). No direct "Assign agent to project" affordance.
- **Recommended remediation scope:** see §5.5.

## Section 7 — Dashboard spec CRUD

Inspected via `/specs` route + API.
Screenshot: `evidence/audit/06-specs-page.png`.

### 7.1 Spec list rendering
- **Verdict:** `partial`
- **Evidence:** Specs page header shows `0 current specs · 1 total · 0 active`. Tabs: `Current` (selected, empty list message "No specs match this filter"), `Needs attention (1)`, `All`. The 1 imported `hello-readme` spec lives under "Needs attention" because its run stalled. The default "Current" tab displaying empty for the user's only spec is **misleading UX** — operators land on Specs and think "no specs imported."
- **Recommended remediation scope:** `inline-fix`. Default tab should be "All" or "Needs attention" when the latter is non-empty.

### 7.2 Importing a spec via dialog
- **Verdict:** `not-tested`
- **Evidence:** "Import Spec" button visible top-right; not exercised in this audit. The API endpoint works (verified via curl during P5 attempt — Section 4.5).

### 7.3 Editing a spec
- **Verdict:** `not-tested`
- **Evidence:** Click-through to spec detail not exercised in this audit pass.

### 7.4 Setting spec status
- **Verdict:** `partial`
- **Evidence:** P0/P5 spec defines `ductum spec set-status <specId> <status>` CLI. Dashboard side: not directly verified. `SpecList.tsx` was fixed in recovery P0 to render statuses correctly (D110); not regressed here.

### 7.5 Spec list filter behavior
- **Verdict:** `broken (default)`
- **Evidence:** See §7.1.

## Section 9 — Dashboard run views

Inspected via `/runs/<id>` route + API.
Screenshot: `evidence/audit/09-run-detail.png`.

### 9.1 Run list rendering
- **Verdict:** `not-tested`
- **Evidence:** No top-level `/runs` route visible in App.tsx (paths are `/runs/:runId` only — single-run redirect/detail). Run list lives within project detail (§6.2). 4 runs shown with stall states.

### 9.2 Run detail rendering
- **Verdict:** `works`
- **Evidence:** `/runs/yDfj5vBmEyHo` rendered: breadcrumb (Factory / factory / hello-readme / append-readme-line / Run yDfj5v), title `append-readme-line` STALLED, Retry + Transcript buttons, Failure summary with 4 attempts (each stalled at 00:04 with "you are here" marker on the latest), AGENT card (claude-builder, claude-sonnet-4-6), COST $0.00, TOKENS 0/0, STARTED/LAST BEAT timestamps, COMMITS (—), STATE MACHINE diagram (current=Understanding, paused), ACTIVITY log including the verbatim agent error: `Not logged in · Please run /login`.
- **Notes:** This page is one of the more polished surfaces in 0.1.1. Agent error is surfaced clearly.

### 9.3 Approve action
- **Verdict:** `not-tested`
- **Evidence:** No runs reached `pendingApproval=true` in the test factory (all stalled at `understand`). Cannot exercise the approve button.
- **Recommended remediation scope:** Once #7 (claude-agent-sdk creds) is fixed, retest end-to-end.

### 9.4 Cancel action
- **Verdict:** `not-tested`
- **Evidence:** Cancel button (D145) not directly exercised. CLI command exists (`ductum cancel <runId> --reason <text>`).

### 9.5 Cost / token info
- **Verdict:** `works`
- **Evidence:** Shows `0 / 0` in/out tokens, `$0.00` cost. Stalled runs spent nothing. Field shape matches D135 §6.

## Section 10 — CLI happy path

Inspected on the Lima VM with `ductum@0.1.1` global install.

### 10.1 `ductum --version`
- **Verdict:** `works`
- **Evidence:** Returns `0.1.1` cleanly.

### 10.2 `ductum --help`
- **Verdict:** `partial`
- **Evidence:** Top-level help shows ~12 commands: `project, agent, assign, spec, task, run, next-task, accept, complete, update, heartbeat, decide` plus the global flags. Missing from the visible top-level: `init, login, serve, doctor, queue, status, approve, cancel, events, transcript, watch` (all of which exist and work). The help output is incomplete relative to the actual command surface.
- **Recommended remediation scope:** `inline-fix`. Either expose all subcommands at the top level or document the grouping. Operators currently have to know commands by name.

### 10.3 Default `--api-url`
- **Verdict:** `broken`
- **Evidence:** `--help` shows `--api-url <url>  Ductum API URL (default: "http://localhost:4100")`. But `ductum init` binds the API to a *random ephemeral port* (e.g., `49021`). The CLI default doesn't match the init-bound port, so any operator running `ductum status` without `--api-url` hits a stale default and gets a connection error.
- **Recommended remediation scope:** `inline-fix`. CLI should look up the running API's port from the factory directory's `.ductum/` runtime files instead of defaulting to a hardcoded value.

### 10.4 `ductum login` (PKCE)
- **Verdict:** `partial`
- **Evidence:** The PKCE flow works (verified live during P5). Writes `~/.claude/.credentials.json` with the `claudeAiOauth` shape. **But** — the format it writes is not what the bundled `@anthropic-ai/claude-agent-sdk` accepts at runtime (Section 11). So `ductum login` succeeds and *says* you're authenticated, but agents still fail downstream.

### 10.5 `ductum spec import`
- **Verdict:** `works`
- **Evidence:** API endpoint works (verified via curl). CLI direct invocation not exercised this audit.

### 10.6 `ductum --json queue`
- **Verdict:** `works`
- **Evidence:** Returns proper `{counts, approvalsWaiting, activeRuns, readyTasks, needsOperator}` envelope. Counts match the live state.

### 10.7 `ductum run <taskId>`
- **Verdict:** `works`
- **Evidence:** Verified live during P5 — dispatched the `append-readme-line` task; agent crashed (separate issue) but dispatch succeeded.

### 10.8 `ductum status <runId>` URL output
- **Verdict:** `not-tested`
- **Evidence:** Per P0 spec, status should print a paste-safe URL `/runs/<id>`. Not verified in this audit. The redirect route (`/runs/:runId` → canonical `/<project>/<spec>/<task>/<runShort>`) does work — verified during the run-detail screenshot.

### 10.9 `ductum cancel <runId>`
- **Verdict:** `not-tested`

### 10.10 `ductum events` SSE stream
- **Verdict:** `not-tested`

### 10.11 `ductum doctor`
- **Verdict:** `works`
- **Evidence:** Rich 10-check diagnostic including api connection, config validation, per-agent harness availability, operator queue health, telegram runtime, repo hygiene, claude-agent-sdk availability, pi harness status. Returns `status: blocked` with named failures + structured fix suggestions. **Doctor correctly diagnoses #7** as `FAIL: claude-agent-sdk — claude is not available — install or log in to Claude Code`.
- **Notes:** Doctor is one of the most useful surfaces in 0.1.1. The diagnostic shape matches D135's structured-error contract spirit even if the output is human-formatted.

## Section 11 — Agent execution / claude-agent-sdk creds (#7)

Investigation of the showstopper blocker.

### 11.1 Bundled `claude` binary present
- **Verdict:** `partial-data`
- **Evidence:** Found at `$PNPM_HOME/global/5/.pnpm/@anthropic-ai+claude-agent-sdk-linux-arm64@0.2.119/node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/claude`. **Not on PATH.** `command -v claude` returns nothing. `ductum doctor` says `claude is not available`.

### 11.2 Credentials file shape
- **Verdict:** `partial-data`
- **Evidence:** `~/.claude/.credentials.json` written by `ductum login` PKCE has shape `{ claudeAiOauth: { accessToken, expiresAt, refreshToken } }`. `accessToken` value starts with `sk-ant-oat01-` (Anthropic OAuth token prefix). The file mode is 0600.

### 11.3 SDK error at runtime
- **Verdict:** `broken (showstopper)`
- **Evidence:** From `~/ductum/factory/.ductum/logs/api.log` during P5 dispatch attempt: `Error: Claude Code returned an error result: Not logged in · Please run /login`. Three retry attempts all hit the same error. Per stack: error originates from `@anthropic-ai/claude-agent-sdk@0.2.119/sdk.mjs:59`.

### 11.4 Root cause hypothesis
- **Verdict:** `hypothesis (needs validation)`
- **Evidence:** Two candidates:
  1. The bundled `claude` binary needs to be on PATH for the SDK to find it. ductum installs the SDK as a transitive dep but doesn't add the binary's dir to PATH when spawning agents.
  2. The credentials format expected by the bundled `claude` differs from the pi-mono PKCE output shape. The official `claude` CLI may store creds in a different layout (e.g., named keys like `subscriptionAccessToken` rather than `claudeAiOauth.accessToken`).
- **Recommended remediation scope:** `own-arc` or `next-bundle`. This is the highest-priority fix. Without it, fresh-machine agent execution is broken regardless of every other UX fix.
- **Notes:** A clean test: extract `accessToken` from `.credentials.json`, export as `CLAUDE_CODE_OAUTH_TOKEN` (already in the validate-env allowlist after D159), restart the API, retry the run. If that succeeds, the gap is the credentials *file* loading; the fix is wiring ductum-side env injection or rewriting the file in the SDK-expected format.

### 11.5 D159 fix verified
- **Verdict:** `works (within its scope)`
- **Evidence:** D159's API startup guard now accepts ambient `~/.claude/.credentials.json`. The API does start. The bug it fixed is closed. The remaining issue is downstream — runtime agent invocation, not startup gating.


## Section 12 — Defaults audit

Inspected via the live `~/ductum/factory/ductum.yaml` and API config endpoint.

### 12.1 Default workflow profile
- **Verdict:** `broken (auto-naming regression)`
- **Evidence:** Live yaml shows `workflowProfiles: { workflow: {path: PROCESS.md}, workflow-2: {path: PROCESS.md} }`. The `workflow-2` is the same auto-numbering bug surfaced for agents (§5.2): something added a second profile and named it `workflow-2`. Default workflow path `PROCESS.md` is referenced but no such file is in the bundled assets — verifying that, the path is dead.
- **Recommended remediation scope:** `inline-fix` (auto-name regression), `next-bundle` (PROCESS.md or replacement workflow shipped in assets).

### 12.2 Default sandbox profile
- **Verdict:** `broken (schema mismatch)`
- **Evidence:** Live yaml shows TWO parallel sandbox lists: `sandboxes: []` (empty array) AND `sandboxProfiles: { sandbox: { provider: docker, mode: container } }` (populated map). The schema is supposed to have one of these (per D56). The dashboard / config loader reads from one shape; the live data has the other. Any agent that uses `sandboxRef: sandbox` can't resolve it consistently.
- **Recommended remediation scope:** `inline-fix`. Pick one shape, migrate, delete the other.

### 12.3 Default notification channel
- **Verdict:** `partial`
- **Evidence:** Live yaml: `notificationChannels: { telegram: { backend: telegram, config: { enabled: false } } }`. P0 spec said `notificationChannels: []`. Scaffolder ships a disabled telegram entry. Default produces no actual notifications (telegram is disabled, no stdout channel configured). End user gets no completion notifications by default.
- **Recommended remediation scope:** `next-bundle`. Ship a default `stdout` notification channel so `ductum init` produces a factory that at least logs run completion to terminal.

### 12.4 Default model + harness for claude-builder
- **Verdict:** `partial`
- **Evidence:** Init scaffolder writes `claude-builder` with `model: claude-sonnet-4-6, harness: claude-agent-sdk`. Sonnet-4-6 is in the catalog ✓. Harness is the right one ✓. **But** the live yaml after this audit's interactions has lost `claude-builder` entirely — the agents map shows only `0` and `agent-2`. This means dashboard CRUD destroyed the original entry while editing. The default itself (claude-sonnet-4-6 + claude-agent-sdk) is reasonable; the destructive-edit behavior is not.
- **Recommended remediation scope:** `inline-fix`. The agent rename / edit flow should never silently delete the old entry while creating a new one.

### 12.5 Default port for `ductum init` API
- **Verdict:** `partial`
- **Evidence:** Per `init/steps/api-process.ts:findFreeLoopbackPort()`, the port is OS-assigned random in `127.0.0.1:0`. With the demo VM's `ip_local_port_range=49000-49099`, the port lands within that pin (e.g., `49021`). Without pinning, the kernel picks anywhere in `32768-60999`. There's no collision risk on a single machine; the issue is that the CLI's `--api-url` default (`http://localhost:4100`) doesn't match the real bound port (§10.3).

## Section 13 — Bundled assets

### 13.1 hello-readme sample spec present
- **Verdict:** `works`
- **Evidence:** `assets/specs/examples/hello-readme/{README.md, P1-HELLO-README.md}` shipped in the published tarball; verified at `$PNPM_HOME/global/5/.pnpm/ductum@0.1.1/node_modules/ductum/assets/specs/examples/hello-readme/`.

### 13.2 Sample task name vs harness expected name
- **Verdict:** `partial`
- **Evidence:** Bundled task is `name: "append-readme-line"` (verified via `/api/welcome/sample-spec`). The exit demo harness's `hasHelloReadme()` matcher in `scripts/demos/exit-demo-redo.mjs` looks for `task === 'P1-HELLO-README'` or `task.includes('hello-readme')`. The harness *does* fall back to `runs.some(r => r.spec?.name === 'hello-readme')` which catches it (because the spec is named `hello-readme`). So the harness *eventually* finds it via the runs path, just not via the queue path. This makes detection slower and depends on a run already existing.
- **Recommended remediation scope:** `inline-fix`. Either rename the bundled task to match what the harness primarily looks for, or update the harness to also match `task === 'append-readme-line'`. Both fixes are tiny.

### 13.3 Bundled workflow files
- **Verdict:** `partial`
- **Evidence:** `dist/workflows/{coding-guard.yaml, coding-guard-template.yaml}` shipped in the package. The scaffolded `ductum.yaml` references `path: PROCESS.md` for workflow profiles, but **no `PROCESS.md` is shipped** — the scaffolder writes a path the package can't satisfy.
- **Recommended remediation scope:** `inline-fix`. Either ship `PROCESS.md`, or have the scaffolder reference one of the bundled `coding-guard.yaml` paths.

## Section 14 — Documentation parity

### 14.1 README.md in published package
- **Verdict:** `partial`
- **Evidence:** Published README recommends `npm install -g ductum` (correct given the pnpm/scripts gap §1.1). Mentions `ductum init`, `ductum start`, hello-readme sample spec. Brief and accurate. **But** doesn't mention the `pnpm install -g --allow-build=better-sqlite3` workaround or the `?token=undefined` browser-handoff bug or the agent-execution issue (#7). Operators who follow the README and try the demo will hit those silently.
- **Recommended remediation scope:** `inline-fix`. README should at minimum surface the known-broken flows or explicitly recommend `npm` over `pnpm`.

### 14.2 CLI `--help` parity
- **Verdict:** `broken`
- **Evidence:** §10.2 — top-level `--help` lists ~12 commands but actual command surface is ~25 (`init, login, serve, start, doctor, queue, status, approve, cancel, events, transcript, watch, ...`). Operators who learn from `--help` are missing half the tool.
- **Recommended remediation scope:** `inline-fix`.

### 14.3 Error messages with `suggestedActions[].cmd`
- **Verdict:** `partial`
- **Evidence:** `ductum doctor` output includes structured fix lines per check. PKCE-failed flow surfaces `ductum init --resume` and `ductum login` suggested actions. **But** several error paths in this audit returned plain strings without structured suggestions (e.g., the harness exit during P5: `"ductum init failed: 1"` — useless without context). D135 §3 contract is partially honored.

## Section X — Dead/stale code patterns (cross-cutting)

This is the cross-cutting view per the operator's prompt 2026-05-05:
"probably lots of dead code right?"

### X.1 Stale-schema fields (settings form)
The bulk of the Settings page (§8.3-8.10) reads from paths that don't match the API's stored shape. Eight or more form fields silently render empty or default values. Pattern: a previous iteration of the schema was wired into the form, the schema moved (or was always wrong), no fixture pinned the contract. These are not dead — they're stale wiring against ghost data.
- `factory.mergeMode` vs `factory.config.defaultMergeMode`
- `factory.heartbeatTimeout` vs `factory.config.heartbeatTimeoutSeconds`
- `config.port` vs runtime-bound dynamic port (no stored field)
- `config.dashboard` vs no stored field
- `factory.merge.{base, strategy, push}` — no scaffolded defaults
- `factory.costBudget.*` — stored elsewhere (run-level, not factory)
- `factory.worktrees.enabled`, `factory.workflow.observer` — stored elsewhere

### X.2 Inverted/broken auth probe (banner)
The "Operator token required" banner renders on every page including authenticated ones. Either the probe endpoint changed and the SPA wasn't updated, or the conditional is inverted. Real banner code paths exist; the gating condition is broken. (§8.1, §10 evidence: visible on every screenshot.)

### X.3 Garbage data leaking into UI surfaces
Auto-generated names from `addAgent()` (`agent-2, agent-3, ...`) and the broken-rename path that produced an agent named `"0"` leaked into dashboard pickers and yaml. The harness picker now offers a phantom `"0"` option. The workflow-profile registry has `workflow-2` similarly. UI surfaces don't sanitize names; data layer doesn't validate names.

### X.4 Aspirational primitives partially wired
- `usesModelRef` / `usesHarnessRef` branches throughout `AgentConfigPanel.tsx` (resource-ref alternative). Code is present and tests exist; published `ductum init` flow doesn't write resource refs, so these branches are not exercised in the demo path. Either dead or under-used.
- `ConfigResourcesPanel`, `Target`, `WorkflowProfile`, `SandboxProfile`, `NotificationChannel` editors render against a config the scaffolder mostly leaves empty. Operators see empty editors with no obvious next-step.

### X.5 Hardcoded defaults that don't match the bootstrap reality
- `addAgent()` hardcodes `model: "gpt-5.4", harness: "codex-sdk"` regardless of which providers are actually authenticated. On a Claude-only init (the documented P5 path), this default produces an immediately-invalid agent.
- `--api-url` default `http://localhost:4100` doesn't match the OS-assigned ephemeral port `ductum init` actually binds to.
- Default factory yaml ships `path: PROCESS.md` for workflow profiles but no `PROCESS.md` exists in the package (§13.3).

### X.6 Doctor-to-fix gap
`ductum doctor` correctly diagnoses the agent execution failure (#7) with a fix suggestion ("install or log in to Claude Code") — but the underlying gap is that the bundled `claude` binary already exists in the SDK package, just not on PATH. The doctor's fix points the operator at an external action when the actual fix is internal package wiring. The diagnostic surface and the fix surface are out of sync.

## Summary

Per the protocol's required output format.

### Counts (across 14 sections)

| Verdict | Count |
|---------|-------|
| works | 16 |
| partial | 21 |
| broken | 18 |
| unimplemented | 0 |
| not-shipped | 1 |
| not-tested | 13 |

(Some items defer because the agent-execution showstopper (#7) blocks running them honestly. They are flagged with `not-tested` and a remediation pointer.)

### Verdict on the bootstrap-redesign arc

**The arc cannot close as currently shaped, and should not be amended to a narrower contract that hides the dashboard from the demo.** Three strands of debt surfaced:

1. **One showstopper bug at the agent execution layer** (#7 / Section 11). Fresh-machine PKCE-only auth produces a credentials file that the bundled SDK rejects at runtime. Without this fixed, no fresh-machine flow can produce a merged commit. Every other UX issue is downstream of this in priority order.

2. **Multiple shipped-broken UX surfaces** that an end user can not avoid: persistent "Operator token required" banner on authenticated pages (§8.1), default tab on /specs hides the user's only spec (§7.1), Settings form reads from wrong schema paths (§8.3-8.10), `addAgent()` defaults to non-authenticated provider (§5.1), no agent rename UI (§5.2), no agent delete UI (§5.13), CLI `--help` lists half the commands (§10.2), CLI default `--api-url` doesn't match runtime port (§10.3), browser-handoff token literal `"undefined"` (§2.13/§4.2), schema-shape mismatch in sandbox/sandboxProfiles (§12.2), workflow path `PROCESS.md` missing from bundle (§13.3).

3. **Stale/dead/leaked code patterns** (Section X) that are signals of insufficient end-to-end verification. Adding more fixes without changing the verification rigor will produce more of the same.

### Recommended remediation shape

Per the audit checklist's slop-review (no fix-as-you-go), this is the post-audit recommendation. The operator decides which of these to accept.

**(R1) Open a separate UX-quality arc.** Bootstrap-redesign's P3/P4 status in `specs/current/bootstrap-redesign/README.md` should be amended from "Shipped" to **"Partially shipped — see D161 + AUDIT-FINDINGS.md."** A new arc (`specs/current/dashboard-ux-quality/` or similar) inherits the broken/stale items here and ships them in coordinated bundles. Each bundle's exit demo includes an end-to-end click-through of every CRUD form on a fresh install, not just one happy path.

**(R2) Fix the agent execution showstopper as its own targeted bundle.** Section 11 / #7. Highest priority. Fresh-machine demo cannot exist without this. Probably 0.1.2 ships only this fix + the §2.13 token-undefined fix + §10.3 api-url-default fix (all three are tightly coupled to "fresh user gets a working agent run"). Everything else can wait for the UX arc.

**(R3) After R1 + R2 close, retry P5.** The protocol stays as-is. The harness updates from D160 still apply. The clean-VM demo can produce honest evidence at that point.

**(R4) Process-level: amend bootstrap-redesign's slop-review** to attack any future P-file whose exit demo doesn't exercise CRUD forms, default values, and at least one negative path per shipped surface. The 2026-05-05 finding is that exit demos that pass on narrow contracts ship broken products. The slop-review needs to attack that pattern explicitly.

