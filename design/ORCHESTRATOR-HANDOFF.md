# Orchestrator handoff — Ductum redo (phase1 integration)

> You are taking over as the **integration orchestrator** for the Ductum redo. This doc is your
> complete context. Read it fully, then continue the job: verify + merge the remaining worker
> branches into `phase1`, keeping it green. **Never push. Local only.**

## What this is

A **strangler rebuild** of Ductum (an AI agent-work factory) in `/Users/acartagena/project/ductum-next`
— a fresh, clean copy of the prototype with fixes layered on `phase1`. We are NOT greenfielding; we
keep working code and rework the weak parts. Full reasoning + plan live in:
- `design/README.md` (target architecture) · `design/ROADMAP.md` · `design/parallel/PLAN.md` (the
  parallel streams) · `design/decisions-atomic-evidence-commit.md`
- `inventory/README.md` (190-feature map) · `inventory/REFERENCE-ARCHITECTURE.md` · `AGENTS.md`

## Working style (match this)

- **Plain wording.** The operator wants simple, direct explanations — no jargon walls.
- **Honest reporting.** Never claim "done" or "tests pass" unless you ran them and saw it. State
  pass/fail plainly with counts. Flag pre-existing failures as pre-existing (prove it if unsure).
- **Flag bugs proactively**, even out of scope. Security is paramount (this is a security product).
- **Commits:** conventional messages, **no AI/Claude/Codex mentions**, **never push**. Committing
  merges is part of the orchestrator job; do it.
- **Rules:** pnpm only; no source/test file >300 LOC (grandfather list: `decisions/112`); honor the
  C1–C7 constraints and D22–D28 in `CLAUDE.md`/`AGENTS.md`; pin exact dep versions; CI is sacred.

## Current state of `phase1` (verify with `git -C /Users/acartagena/project/ductum-next log --oneline`)

HEAD is `d60e61d`. Already done + verified green (core 647/647, all packages build):
- `5b83875` scoped secret broker (Claude) · `d2c33a0` Codex consume-side · `29931c6` broker **enforce by default** (set `DUCTUM_SECRET_BROKER_MODE=warn` to revert)
- `9684542` idempotent (content-addressed) evidence write · `a74c1fb` atomic approval-rejection
- `fc71782` restored 59 READMEs the seed's rsync wrongly dropped (fixed the welcome-handoff test)
- `a5a2d15` **merged stream/dashboard** (brand reskin + IA cleanup) · `9e9fdaa` **merged stream/sandbox** (pluggable driver, container-ready types) · `d60e61d` grandfather cleanup

## The parallel streams (worktrees share `phase1`'s git — you can checkout/build any branch)

| Stream | Worktree | Branch | Status |
|---|---|---|---|
| A Dashboard | `/Users/acartagena/project/dn-dashboard` | `stream/dashboard` | ✅ MERGED |
| C Sandbox | `/Users/acartagena/project/dn-sandbox` | `stream/sandbox` | ✅ MERGED |
| D Cost | `/Users/acartagena/project/dn-cost` | `stream/cost` | ✅ DONE (`dc97fa8`) — **ready to merge** |
| B Recovery | `/Users/acartagena/project/dn-recovery` | `stream/recovery` | ⚠️ DONE (3 commits) but **BLOCKED** — 4 HIGH review findings; needs a fix round before merge (see `design/parallel/recovery-fixes.md`) |

## Your merge loop (do this for each remaining stream)

1. **Verify the branch independently** in its worktree before merging:
   `pnpm -C /Users/acartagena/project/dn-<x>/packages/core build` and `… exec vitest run` (and the
   dashboard package if it touched UI). Confirm the worker's claimed pass counts yourself.
2. **Merge** into phase1: `git -C /Users/acartagena/project/ductum-next merge --no-ff stream/<x> -m "merge: … (stream/<x>)"`.
3. **Resolve conflicts** (see heads-ups below) — keep both sides; these are additive.
4. If deps changed, `pnpm -C /Users/acartagena/project/ductum-next install --frozen-lockfile`.
5. **Re-verify on phase1:** full `pnpm build`, then the affected packages' tests. Must be green.
6. Each worktree has an untracked `BRIEF.md` (the worker's instructions) — do NOT commit it; ignore it.

## Pending merge #1 — Cost (`stream/cost`, `dc97fa8`) — READY NOW

Adds a 4-state cost model (measured / **unpriced** = usage known but no rate / pending / **unmeasured**
= no usage), GLM-5.2 official pricing ($1.40 in / $4.40 out, source Z.AI), and rollups that count
unpriced/unmeasured instead of showing a fake $0. Worker-verified: core 654, dashboard 249, api 418
(+1 pre-existing welcome-handoff — but that's **already fixed in phase1** by `fc71782`, so on the
merged branch api should be fully green; confirm).
- **KNOWN CONFLICT:** it touched ~8 dashboard component/page files (`RunFeed`, `SpecGroups`,
  `HomepageActiveSpecsCard`, `ProjectAgentsPanel`, `ProjectDetail`, `SpecDetail`, `BakeoffComparePanel`)
  for cost-rollup broadening — these overlap the dashboard reskin merge. Conflicts are one-line
  predicate swaps (`=== 'unmeasured'` → `isCostUnknown(...)`) + one import each. **Resolve by keeping
  both** (the reskin's styling + cost's predicate). Then verify dashboard build + tests.

## Pending merge #2 — Recovery (`stream/recovery`) — DO NOT MERGE until the fix round lands

⚠️ The recovery worker finished (3 commits, 679 core tests pass) BUT its own adversarial review found
**18 findings incl. 4 HIGH** in the dispatcher core (lost worktrees, re-running push/merge at `ship`,
split-brain double-resume, unbounded failover ping-pong). A fix-worker (GPT 5.5) is addressing them per
`design/parallel/recovery-fixes.md`. **Do not merge `stream/recovery` until those fixes land and you
re-verify**: confirm the 4 HIGH are addressed in the new commits (check them against `recovery-fixes.md`),
then `pnpm build` + full core + api tests green, then merge. Merging the unfixed version into the
moat-adjacent dispatcher would be unsafe. Once fixed — review carefully; this is THE BIG ONE.

Touches the **dispatcher core** (`dispatcher-session.ts`, `state-machine.ts`, new `run-checkpoint.ts`
+ repo, `dispatcher-resume.ts`, `dispatcher-session-cost.ts`, migration **042**). Original commit did
crash checkpoint/resume; the **followup** adds operator pause/freeze, unifies the existing
budget/turn pauses to resume-from-checkpoint, and a **limits policy**: classify the harness failure →
transient (429) auto-retry-with-backoff; recoverable-external (out of credits/auth) → wait the reset
window if known, else **failover to another agent of the same role with a different provider**, else
freeze+notify; policy limit → freeze+notify+resume; terminal → fail with evidence.
- **Review extra carefully** — this is the moat-adjacent code. Do NOT let it change the fragile
  `refreshRunFromWorkflow` 'done' guard in `enforce.ts`.
- **Likely conflicts:** (a) `packages/core/src/index.ts` — both Recovery and prior commits add export
  lines (different positions → usually auto-merges; keep all). (b) `api/src/index.ts` — Recovery added
  ~8 lines; the enforce commit also edited this file → hand-merge, keep both. (c) `db-migrations.ts` —
  Recovery uses migration 042; if you bump the count, update `packages/core/src/tests/db.test.ts` (the
  migration-count assertion). (d) `dispatcher-session-cost.ts` (Recovery) is cost-domain — make sure it
  doesn't fight Cost's `cost-scanner.ts`/`model-pricing.ts` changes; they're different files but verify.
- After merge: full build + **core tests** + **api tests** green.

## Flagged follow-ups (do after the merges, or note for the operator)

1. **CLI has the same `$0` cost bug** — `packages/cli/src/commands/common.ts:23` does
   `if (tokens) return '<$0.01'`. Same invariant as the dashboard fix (a priced model never yields $0
   for real tokens). One-line fix to surface unpriced/unmeasured. Easy win.
2. **Cost scanner reads the operator's whole `~/.codex` and `~/.claude` tree** (`cost-scanner.ts`
   `discoverFiles` walk) — a privacy concern. Tighten it (scope to the run's session) — belongs with
   the secrets/sandbox hardening, not a rushed change.
3. **Secret broker is now enforce-by-default but unverified against a live run.** Only a real dispatch
   in the operator's environment confirms agents still authenticate. If a run breaks on a missing host
   var, the operator sets `DUCTUM_SECRET_BROKER_MODE=warn` and reports which var to allowlist in
   `scoped-secret-broker.ts` (`BASE_HOST_ALLOWLIST` / `DEFAULT_REQUIRED_HOST_ENV`).
4. **One flaky api test** — the api suite intermittently shows 1 failure (~1 in 4 runs), not tied to
   any of our changes. Worth tracking down; re-run to confirm green before trusting a single red.

## What's NOT done yet (after these merges, the next work)

- Real **container/Podman sandbox driver** (the interface is ready from Stream C — this is the next
  stream; brief it like the others). Podman recommended (rootless, daemonless).
- The deferred **transactional gate-commit** (see `design/decisions-atomic-evidence-commit.md` — it's
  parked because Edictum's storage is async; needs the recovery/replay path first).
- Then per `ROADMAP.md`: autonomy/legibility polish, the rest of the UI, extensibility/DX.

## First action

Merge **stream/cost** now (it's ready). **Do NOT merge stream/recovery yet** — it's blocked on the fix
round above. When the operator says the recovery fixes are done, verify the 4 HIGH findings in
`design/parallel/recovery-fixes.md` are addressed in the new commits, run `pnpm build` + full core + api
tests, and only then merge. Keep `phase1` green at every step; tell the operator plainly what's merged
and what's left.
