# CLI Surface

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The CLI surface is healthy and tightly aligned to the D166/D169 operator model (Factory -> Project -> Repository/Component -> Spec -> Task -> Attempt). The public top-level command set in program.ts exactly matches the D169 allowlist, all retired surfaces (run/target/resource/config/operator/doctor/queue/telegram/budget/turns) are gone and actively guarded by cli-cutover-command.test.ts and public-contract-drift.test.ts. Command code is small, consistently structured around createAction/CliContext, and output is redacted via redactPublicText. The main weaknesses are (a) the live-harness session coupling reflected indirectly in attempt-start's blocking SSE+poll progress stream, (b) a still-present Copilot auth path and "seed" surface in the init subtree (retirement candidates), and (c) a stale file-size grandfather list (D112) referencing CLI files that no longer exist or no longer exceed the limit.

## init / start (serve) bootstrap
- **What:** `init` scaffolds a local factory directory (human TUI or structured JSON path) and `start` launches/opens the local API + dashboard, resolving operator token, port, and persisted serve config before spawning the API process.
- **Where:** `commands/init.ts:11-48`, `init/` subtree (`structured.ts`, `human.ts`, `steps/*`); `commands/serve.ts:31-240`
- **Maturity:** live-core
- **Quality:** solid — serve.ts has loopback-bind refusal (`serve.ts:58-60`), explicit token resolution chain with placeholder rejection (`serve.ts:192-206,237-240`), `--dry-run` plan, and structured envelopes; init has dedicated error/cancel handling.
- **Operator-legibility risk:** none — renders human plans and next-steps; no raw state required.
- **Dependencies:** `serve/api-runtime.ts` (buildApiEnv/buildApiProcessArgs), `serve/db-config.ts`, `serve/factory-data.ts`, `login/open-browser.ts`; API entry must exist on disk.
- **Disposition (recommended):** KEEP — matches the documented normal path and is the canonical entry point.
- **Flags:** legacy: `init/steps/auth-copilot.ts` (Copilot harness auth) and `init/steps/welcome-seed.ts` ("seed" surface) are retirement candidates per the source-of-truth-backlog OpenCode/Copilot cleanup and the resource/seed retirement; review whether init still wires them. Security: the API is spawned via `serve.ts:spawnApi` with env built by `buildApiEnv`; whether the dispatched-agent env passthrough leak (claude.ts:186-188) is bounded is an API/harness concern, not fixable in the CLI command itself.

## project / spec / task admin commands
- **What:** CRUD-and-list verbs for Projects (list/create/show/delete + agent assign/unassign), Specs (list/create/approve), and Tasks (list/create/depend/assign/dag), the structural backbone of the operator model.
- **Where:** `commands/admin.ts:11-250`
- **Maturity:** live-core
- **Quality:** solid — consistent name-resolution via `common.ts` require* helpers, table/summary rendering, ambiguity errors with actionable hints (`common.ts:75-126`); task create enforces non-empty prompt.
- **Operator-legibility risk:** none — formatted tables, status badges, DAG ASCII.
- **Dependencies:** `common.ts`, `format.ts`, api-client; delegates to spec-import/intake/bakeoff registration.
- **Disposition (recommended):** KEEP — direct expression of the canonical primitive model.
- **Flags:** none. (Local var `target` in show/delete is project, not the retired Target vocabulary; project `config.workflowPath`/`repos` are still live project fields.)

## repository command group
- **What:** `repository list` / `repository add` to attach local-path or remote-URL repositories to a Project, with git-worktree validation of local paths.
- **Where:** `commands/repositories.ts:22-95`
- **Maturity:** live-core
- **Quality:** solid — `validateLocalGitRepositoryPath` checks existence, directory, and `git rev-parse --is-inside-work-tree` with a timeout; readiness column reflects local-vs-remote capability.
- **Operator-legibility risk:** none.
- **Dependencies:** `common.ts` requireProjectByName, node child_process/fs; reused by `admin.ts` project-create via `repositoryInputsFromOptions`.
- **Disposition (recommended):** KEEP — this is the P7 Repository rename landing surface (replaces old Target vocabulary correctly).
- **Flags:** none. Note: readiness only distinguishes local-ready vs remote-only, reflecting the laptop-bound sandbox limitation (REDESIGN lives in the sandbox/runtime domain, not here).

## attempt start (dispatch + live progress)
- **What:** `attempt start <task>` resolves a task by name/id, dispatches it to an agent, then streams live progress (SSE with polling fallback) until terminal or workflow-followup handoff.
- **Where:** `commands/attempt-start.ts:17-66`, `commands/run-dispatch.ts:99-269`
- **Quality:** adequate — robust task disambiguation and a dual SSE+poll race (`run-dispatch.ts:178-260`); but it is a long-lived foreground stream tied to a single live attempt, mirroring the dispatcher<->live-harness session coupling, and parses SSE data with bare `JSON.parse` (`run-dispatch.ts:196,202`) with only a broad try/catch.
- **Maturity:** live-core
- **Operator-legibility risk:** none — phases rendered via `formatAttemptPhase`.
- **Dependencies:** `status-data.ts` snapshot loader, `status-followup.ts`, api `dispatch`/`getRun`, `/api/events/stream`.
- **Disposition (recommended):** REUSE — the command shape is fine, but the in-CLI blocking session-progress stream sits on the same non-serializable live-session lifecycle flagged for REDESIGN at the runtime layer; expect this to move behind a more durable progress boundary.
- **Flags:** bug-risk: malformed SSE `data:` lines throw inside the stream loop and are only swallowed by the outer catch, silently ending SSE and falling back to polling (degraded UX, not data loss).

## approval / lifecycle ops (approve / deny / retry / cancel)
- **What:** Operator decision verbs: `approve` (with `--rebase` one-step rebase+verify+merge), `deny --reason`, `retry`, and `cancel --reason [--cleanup-worktree]`.
- **Where:** `commands/factory-ops.ts:10-119`, `commands/cancel.ts:14-80`
- **Maturity:** live-core
- **Quality:** solid — stale-approval detection drives a self-describing `--rebase` hint (`factory-ops.ts:38-40`), failure paths print next/followup commands and throw non-zero; cancel requires a reason and reports cost/worktree disposition.
- **Operator-legibility risk:** none — every failure renders phase + suggested next command.
- **Dependencies:** `@ductum/core` stale-approval helpers, `status-overview.formatAttemptPhase`, api approve/reject/retry/cancel.
- **Disposition (recommended):** KEEP — clean expression of the approval-boundary wedge.
- **Flags:** none. (factory-ops.ts is a stale entry in the D112 grandfather list — listed at 326 LOC, actually 119.)

## status (overview + attempt detail)
- **What:** `status` with no arg renders a workspace overview (projects, factory-activity counts, setup state, needs-attention, next actions); with an attempt id renders run summary + history + evidence + gate checks + dashboard URL.
- **Where:** `commands/status.ts:10-79`, `commands/status-overview.ts:56-239`, `commands/status-data.ts:1-288`, `commands/next-action.ts:29-102`
- **Maturity:** live-core
- **Quality:** solid — derives operator-facing phase labels, leaf-run/followup-aware activity counting (`status-data.ts:225-256`), bounded reason compaction, and a deterministic shared next-action engine reused by status/watch/repair.
- **Operator-legibility risk:** none — this is the primary legibility surface; raw stages mapped to human phases via `formatAttemptPhase`.
- **Dependencies:** loadWorkspaceSnapshot (N+1 fan-out across projects/specs/tasks/runs), `next-action.ts`, `attempt-actions.ts` command builders.
- **Disposition (recommended):** KEEP — central, well-factored legibility surface aligned to the model.
- **Flags:** perf note (not a bug): `loadWorkspaceSnapshot` issues per-task dependency+run fetches (`status-data.ts:44-58`); fine at laptop scale but quadratic-ish as factories grow.

## watch (live event stream)
- **What:** `watch` streams factory-activity or single-attempt events (stage changes, dispatch, approvals, agent activity, gate evaluations) with `--once`, `--timeout`, and project/spec/task scoping.
- **Where:** `commands/watch.ts:47-262`
- **Maturity:** live-core
- **Quality:** solid — typed event allowlist (`watch.ts:208-221`), ref-label maps for human-readable ids, operator-token headers on the stream, clean abort/timeout handling.
- **Operator-legibility risk:** none — events rendered to phase-labeled one-liners.
- **Dependencies:** `event-stream.ts` openEventStream (injectable for tests), `api-request.operatorTokenHeaders`, snapshot + next-action builders.
- **Disposition (recommended):** KEEP — makes blocked/approval/gate activity visible, which is the wedge.
- **Flags:** none.

## logs / transcript
- **What:** `logs <attemptId>` prints an attempt transcript: progress updates plus bounded activity rows (tool calls, text, results) with `--limit`/`--raw` and a next-action hint.
- **Where:** `commands/transcript.ts:10-99`
- **Maturity:** live-core
- **Quality:** solid — limit clamped to 5000 (`transcript.ts:49-53`), one-line previews capped at 180 chars, tool-call argument extraction; aligns with the bounded-evidence/activity-limits finding.
- **Operator-legibility risk:** partial — `--raw` exposes full activity content; default view is summarized and safe.
- **Dependencies:** api getRun/getRunUpdates/getRunActivity, `format.ts`.
- **Disposition (recommended):** KEEP — bounded and operator-legible.
- **Flags:** none.

## repair
- **What:** `repair` lists setup/readiness/attempt-recovery items grouped by what they block, including a recovery detail view of failed/stalled attempts with status/logs/watch/retry next-commands.
- **Where:** `commands/repair.ts:10-76`, plus shared recovery selectors in `status-data.ts:173-186`
- **Maturity:** live-core
- **Quality:** solid — tolerant of missing snapshot (`.catch(() => null)`), renders severity/record/field/reason/action per D169 repair-first guidance.
- **Operator-legibility risk:** none — explicitly designed to replace manual driving of old run/target machinery.
- **Dependencies:** api getRepairReport (server-side RepairReport), workspace snapshot.
- **Disposition (recommended):** KEEP — the D169-sanctioned recovery entry point.
- **Flags:** none. (Reflects the "retry the whole thing" recovery model; the deeper checkpoint/atomic-gate REDESIGN lives in the runtime domain, not the CLI.)

## spec intake / import (contract-gated)
- **What:** `spec intake` audits a file-backed Markdown spec against a contract and optionally imports tasks; `spec import` imports directly, blocking on incomplete contracts unless `--waive-contract`. Supports `--repository`/`--component` default scoping.
- **Where:** `commands/spec-intake.ts:15-181`, `commands/spec-import-command.ts:16-88`, supporting `spec-contract-audit.ts`, `import-handler.ts`, `spec-import*.ts`
- **Maturity:** live-core
- **Quality:** solid — contract gate enforced (throws on incomplete unless explicitly waived), waiver recorded in output, README.md+P*.md Markdown path is the live shape with YAML explicitly marked historical (`spec-import-command.ts:23`).
- **Operator-legibility risk:** none — renders contract markdown report + next commands.
- **Dependencies:** import-handler, contract audit, project name resolution.
- **Disposition (recommended):** KEEP — Markdown-spec import is current; correctly demotes legacy YAML.
- **Flags:** legacy-adjacent (not in commands/): test `spec-resource-apply-helpers.ts` retains "resource"-era naming and is still imported by `spec-import-visibility.test.ts`; cosmetic/test-only, candidate for rename.

## spec bakeoff (best-of-N)
- **What:** `spec bakeoff create` (2-5 builders + cross-model reviewer + policy) and `spec bakeoff compare` (candidate scores, cost, verdict, next actions).
- **Where:** `commands/spec-bakeoff.ts:24-232`
- **Maturity:** live-peripheral
- **Quality:** adequate — strong input validation (builder count, dup detection, same-model-reviewer rejection at `spec-bakeoff.ts:125-131`); rich compare table; but `--repository-id`/`--component-id` are passed as raw ids (no name resolution like other commands), and the `--agents` alias for `--builders` is mild surface bloat.
- **Operator-legibility risk:** partial — `--repository-id`/`--component-id` require the operator to know raw ids rather than names.
- **Dependencies:** api createBakeoff/getBakeoffCompare, agent resolution.
- **Disposition (recommended):** REUSE — capability is sound and fits the wedge, but expect it to sit behind name-based scope resolution consistent with the rest of the CLI.
- **Flags:** legacy vocabulary risk: it exposes both `--repository-id` and `--component-id` as raw-id flags, diverging from the name-first resolution used everywhere else; worth aligning.

## factory settings (read-only catalogs)
- **What:** `factory settings` prints catalog counts for Providers, Models, Harnesses, Workflows, Agents, Sandboxes, Notifications, Budgets, Runtime.
- **Where:** `commands/factory-settings.ts:8-31`
- **Maturity:** live-peripheral
- **Quality:** adequate — correct, minimal; read-only summary only (mutation lives in the dashboard/API per the P6 Settings rebuild).
- **Operator-legibility risk:** none.
- **Dependencies:** api getFactorySettings, `FactorySettingsCatalogs` type.
- **Disposition (recommended):** KEEP — thin, accurate window onto the Factory Settings owner described by D166.
- **Flags:** none.

## attempt-actions / next-action command builders (shared helpers)
- **What:** Pure helpers that build canonical `ductum <verb>` command strings (approve/deny/retry/status/watch/logs/attempt start) and the shared next-action decision engine, consumed by status, watch, repair, and attempt-start.
- **Where:** `commands/attempt-actions.ts:1-61`, `commands/next-action.ts:29-102`, `commands/common.ts:1-158`, `commands/status-followup.ts:5-42`
- **Maturity:** live-core
- **Quality:** solid — single source of truth for operator command suggestions, CLI-arg quoting via `quoteCliArg`, stale-approval-aware command selection; well unit-tested.
- **Operator-legibility risk:** none — these exist specifically to hand operators safe copy-paste commands.
- **Dependencies:** `@ductum/core` (quoteCliArg, classifyTask, stale-approval helpers), status-data selectors.
- **Disposition (recommended):** KEEP — eliminates command-string drift across surfaces.
- **Flags:** none.
