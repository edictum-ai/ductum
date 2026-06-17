# Parallel build plan — phase1 streams

One orchestrator session (holds the design, reviews, verifies, merges) + 4 worker sessions in
isolated git worktrees, each on its own branch off `phase1`. Workers never push; they commit on
their branch and report back; the operator pastes the result to the orchestrator, which merges.

## Streams, worktrees, models

| Stream | Worktree | Branch | Suggested model | Migration # reserved |
|---|---|---|---|---|
| A — Dashboard UI | `/Users/acartagena/project/dn-dashboard` | `stream/dashboard` | GPT 5.5 or GLM 5.2 | none |
| B — Recovery | `/Users/acartagena/project/dn-recovery` | `stream/recovery` | Opus 4.8 (most careful) | 042 |
| C — Sandbox | `/Users/acartagena/project/dn-sandbox` | `stream/sandbox` | GLM 5.2 | 043 |
| D — Cost $0 | `/Users/acartagena/project/dn-cost` | `stream/cost` | GPT 5.5 | 044 |

Orchestrator (this session) does items 1 (flip secret broker to enforce) + 2 (fix welcome-handoff
test) directly, and owns integration.

## Conflict rules (so branches merge cleanly)

1. **Stay in your lane.** Each stream edits only its assigned files (below). Dashboard touches only
   `packages/dashboard/`.
2. **Shared files — minimal touch, report it.** If you must edit `packages/core/src/index.ts`
   (barrel exports) add ONLY your one `export *` line. If you add a DB migration, use your reserved
   number and append a single object to the `MIGRATIONS` array in `db-migrations.ts`. Call these out
   in your report so the orchestrator merges them by hand.
3. **`dispatcher-session.ts` is owned by Stream B (Recovery).** C and D must not edit it. If Cost
   needs a value from the session-end path, return a marker from `cost-scanner.ts` and tell the
   orchestrator; do not edit the dispatcher.
4. **No file over 300 LOC** (split if needed). Honor C1–C7. Pin exact dep versions. Do not push.

## Merge order (orchestrator)

Dashboard (A) merges any time — it's a separate package. Then B → C → D, resolving the trivial
migration/export append-conflicts and running `pnpm build` + the touched package's tests green after
each merge into `phase1`.

---

## Brief — Stream A: Dashboard UI

Repo worktree: `/Users/acartagena/project/dn-dashboard` (branch `stream/dashboard`, deps installed —
run `pnpm install --frozen-lockfile` if `node_modules` is missing). Authorized internal work.

READ FIRST: `design/05-ui-ux.md`, `design/README.md` (principles), and the Ductum brand essentials:
near-black canvas `#111318`, single signal blue `#2F6FED`, fonts Inter (body) + Archivo Expanded
(display, uppercase) + JetBrains Mono (IDs/states/numbers), "Bloomberg terminal, not landing page"
restraint, decisive 90/180/240ms motion. Run-state colors: done=emerald, failed=red, running=blue,
queued=sky.

TASK (scope to packages/dashboard ONLY): adopt the brand book. (1) Replace the shipped Geist font
with Inter + Archivo Expanded + JetBrains Mono. (2) Reconcile the two design-token systems
(`components/signal/` vs shadcn `components/ui/`) toward one — pick the signal token system as the
source of truth and align colors/spacing to the brand. (3) Apply the dark/signal-blue styling and
restraint across the core screens (homepage/inbox, run detail, settings, approvals). (4) Remove dead
pages: `TreeNavigator.tsx`, `RelativeTime.tsx`, legacy `/specs` (SpecList) and `/agents` (AgentList);
fix confusing page names per `design/05-ui-ux.md`. Keep behavior identical — this is a reskin + IA
cleanup, not new features.

CONSTRAINTS: only `packages/dashboard/`. No file >300 LOC. Run `pnpm -C packages/dashboard build` and
`pnpm -C packages/dashboard exec vitest run`. Commit on `stream/dashboard` (clear message, no
AI/Claude/Codex mentions). Do NOT push.
REPORT: files changed, exact build + test output (never claim pass if it failed), screenshots/notes
on the visual result, and any judgment calls.

---

## Brief — Stream B: Recovery (checkpoint/resume)

Repo worktree: `/Users/acartagena/project/dn-recovery` (branch `stream/recovery`). Authorized internal work.

READ FIRST: `design/04-autonomy-recovery.md`, then `packages/core/src/dispatcher-session.ts`
(retryOrFailStalledTask), `dispatcher-reconcile.ts`, `state-machine.ts`, `dispatcher-cycle.ts`.

PROBLEM: today a crashed/timed-out task is re-queued and re-dispatched as a BRAND-NEW run at stage
`understand` with a FRESH worktree — all prior progress and cost are thrown away; heartbeat-stalls get
no auto-retry. We want **checkpoint/resume**: on recovery, resume the run at its last completed stage
with the prior worktree, instead of restarting from scratch.

TASK (per `design/04`): add a durable per-run checkpoint (last completed stage + worktree paths +
attempt identity), and a resume-at-checkpoint dispatch path that re-spawns at the checkpointed stage
reusing the worktree. Keep the existing reattach path for the live-session case. If you need a DB
migration, use number **042**. You OWN `dispatcher-session.ts`. Do not change the Edictum
StorageBackend contract (D28). Honor C4 (Ductum owns resets; agents never self-reset).

CONSTRAINTS: stay in the dispatcher/recovery files. No file >300 LOC. Add tests for: crash mid-run →
resume at last stage with the same worktree (not a fresh run). Run `pnpm -C packages/core build` and
`pnpm -C packages/core exec vitest run`. Commit on `stream/recovery`, no AI mentions, no push.
REPORT: files changed, the migration number used, exact build + test output, and any judgment calls.
If you hit the fragile `refreshRunFromWorkflow` 'done' guard, STOP and report rather than changing it.

---

## Brief — Stream C: Sandbox driver (host, behavior-preserving)

Repo worktree: `/Users/acartagena/project/dn-sandbox` (branch `stream/sandbox`). Authorized internal work.

READ FIRST: `design/03-execution-harness-extensible.md` (the "SandboxDriver" component + strangler
step S2), then `packages/core/src/sandbox-runtime.ts`.

PROBLEM: sandboxing is hardcoded to a single `host-worktree` mode; there's no interface to add a
real (container/remote) sandbox later, and the boundary descriptor over-claims isolation.

TASK (S2 only — interface + host driver, ZERO behavior change): generalize `sandbox-runtime.ts`
behind a `SandboxDriver` interface (`prepare(bundle) -> PreparedSandbox`, `boundary()`, `teardown()`)
with the current worktree logic refactored into a `host` driver. Keep the existing validation
discipline (rejecting unimplemented isolation claims). Replace the open `resourceSpec` map with a
typed `SandboxSpec`. Do NOT build a container driver — interface + host only. If you need a migration,
use **043** (likely none).

CONSTRAINTS: confine to `sandbox-runtime.ts` + a new `sandbox-driver.ts` (and one export line in
`packages/core/src/index.ts`). No file >300 LOC. Existing sandbox tests must stay green; add a test
that the host driver reports its boundary honestly. Run `pnpm -C packages/core build` +
`pnpm -C packages/core exec vitest run`. Commit on `stream/sandbox`, no AI mentions, no push.
REPORT: files changed, exact build + test output, judgment calls.

---

## Brief — Stream D: Cost $0 → "unmeasured"

Repo worktree: `/Users/acartagena/project/dn-cost` (branch `stream/cost`). Authorized internal work.

READ FIRST: `packages/core/src/cost-scanner.ts`, `model-pricing.ts`, and how cost is surfaced in the
dashboard run detail.

PROBLEM: when the local cost scanner can't find a Codex run's usage, cost is silently recorded/shown
as `$0` — which reads as "free" when it actually means "unknown". The scanner also reads the
operator's whole `~/.codex` / `~/.claude` tree.

TASK: when cost cannot be determined, represent it as an explicit **`unmeasured`** marker instead of
`0`, and surface "unmeasured" (not "$0") in the dashboard run-detail cost display. Do the minimal,
clean change: `cost-scanner.ts` returns a discriminated result (`{ measured: true, usd }` |
`{ measured: false }`); the display renders "unmeasured". Do NOT edit `dispatcher-session.ts` (Stream
B owns it) — if the recording call site is there, return the marker and note it for the orchestrator
to thread. If you need a migration, use **044**.

CONSTRAINTS: confine to `cost-scanner.ts`, `model-pricing.ts` (if needed), and the dashboard cost
display component. No file >300 LOC. Add a test: scanner-miss → `unmeasured`, not `0`. Run
`pnpm -C packages/core build`, `pnpm -C packages/core exec vitest run`, and the dashboard build if you
touched it. Commit on `stream/cost`, no AI mentions, no push.
REPORT: files changed, whether you needed to touch a shared/dispatcher file (and what you did
instead), exact build + test output, judgment calls.
