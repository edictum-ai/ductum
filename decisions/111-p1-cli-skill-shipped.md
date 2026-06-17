# D111: Factory Readiness Recovery — Stage 1 (P1 CLI Skill) shipped

**Date:** 2026-04-30
**Decided by:** Arnold + Claude Opus
**Supersedes:** —
**Linked spec:** `specs/current/factory-readiness-recovery/P1-CLI-SKILL.md`
**Linked task:** `JOaQE-vsEk8L` (P1-CLI-SKILL, project ductum, spec
factory-readiness-recovery)

## Context

D110 named the operator-direct task-complete gap as the immediate
Stage 1 follow-up: until Ductum exposed a CLI to mark an
operator-direct deliverable `done` with an evidence trail, the only
way to record stage closures was a decision file plus a manual
README flip. P1's `ductum-cli` skill could not honestly teach
recovery recipes for operator-direct work without that command.

Stage 1 shipped two things, in order:

1. `ductum task complete <taskIdOrName> --reason <text>` (CLI + API).
2. The `ductum-cli` skill at `.claude/skills/ductum-cli/SKILL.md`,
   self-tested against a fresh subagent.

## Deliverables (with commits)

All commits on `main`, pushed to origin.

| # | Item | Commit |
|---|---|---|
| 1.1 | `ductum task complete` CLI + `POST /api/tasks/:id/complete` API + tests | `162e029` |
| 1.2 | `ductum-cli` skill (`.claude/skills/ductum-cli/SKILL.md`) + self-test transcript + this decision | _(this commit)_ |

## Behavior of the new task-complete path

- API: `POST /api/tasks/:id/complete` with `{ reason }`.
- CLI: `ductum task complete <taskIdOrName> --reason <text> [--project <p>] [--spec <s>]`.
- Marks the task `done` without dispatching a run. Skips the normal
  execution-integrity gate because this IS the operator override.
- Records a `Decision` keyed to the task with `decidedBy=operator`,
  `decision=operator-complete: <reason>`. If the task has any prior
  runs, also attaches an `operator-note` evidence row to the most
  recent one.
- Idempotent: a second call against an already-done task is a no-op.
  Refuses to complete a task that has an active run (close or
  end-session that run first).

## Skill scope

- Single self-contained file at `.claude/skills/ductum-cli/SKILL.md`,
  476 lines.
- Hard rules section names exactly the four bypasses operators tend
  to reach for: curl, sqlite3, hand-edited yaml, `--no-verify`.
- Quick map table routes by intent (configure / intake / dispatch /
  inspect / recover / operator-direct close-out), not alphabetical.
- Recovery recipes mapped to actual 2026-04-30 audit failure modes:
  stuck implement after session end (`run end-session`), reviewer
  chain malformed (`operator-ship`), stale approval row (rebase +
  re-link + re-approve), retry (`retry`), stale review with no live
  session (`run-close`), abandoned spec (`spec set-status failed`),
  operator-direct shipped task (`task complete`), reconcile
  (`reconcile [--dry-run]`).
- Reference index at the bottom enumerates every supported CLI
  command.

## Self-test evidence

Recorded at `evidence/p1-skill-self-test/20260430T214519Z/`.

A fresh general-purpose subagent (Opus) was given **only** the skill
file and `AGENTS.md` as its knowledge corpus, plus a brief naming the
sandbox API URL, operator token, and pre-seeded run/spec ids. It
completed all five P1 behavior-contract steps:

1. `spec import` — surfaced the contract gate exactly as the skill
   described, with `--waive-contract` named as the explicit
   override.
2. `queue` + `dispatcher status` + `dispatcher cycle` — observed
   the dispatcher reachable, no real adapter wired so `tasksDispatched=0`
   (expected per fixture).
3. `approve <runId>` — returned `approved → merged` against the
   seeded ship/pendingApproval run.
4. `operator-ship <runId> --reason ...` — advanced the seeded
   implement run to `ship` with `pendingApproval=true` on the first
   try.
5. `spec set-status <specId> failed --project skilltest` — flipped
   the abandoned spec.

Counters from the audit:
- 7 Ductum CLI commands run.
- 0 curl invocations.
- 0 `sqlite3` reads/writes by the subagent. (The operator's fixture
  seed did use `better-sqlite3` to inject pre-staged runs at specific
  stages — that is fixture preparation, not agent-under-test action.)
- 0 yaml hand-edits.
- 0 source-tree reads under `packages/`/`decisions/`/`specs/`.

## Stage 1 dogfood proof

Task `JOaQE-vsEk8L` was marked done via the new CLI against the
real factory:

```sh
ductum task complete JOaQE-vsEk8L --reason "Stage 1 shipped: ductum-cli skill + task complete CLI"
# Completed task P1-CLI-SKILL (JOaQE-vsEk8L); decision M1yhouT3FwOE.
```

Decision `M1yhouT3FwOE` is the on-factory record. This decision
(D111) is the on-repo record. Both exist on purpose — D110 explained
why a `task complete` CLI was needed, and D111 closes the loop.

## Skill follow-ups (Stage 2+)

Two non-blocking documentation polish items the self-test surfaced:

1. The Prerequisites section names the default API URL but does not
   call out the `--api-url` flag explicitly. A fresh agent on a
   non-default port will not learn about it from the skill alone.
2. The example `export DUCTUM=...` alias would be more useful if it
   showed how to bake `DUCTUM_OPERATOR_TOKEN` and `--api-url` into
   the alias for non-default environments.

Carry both as Stage 2+ skill polish, not Stage 1 blockers.

## Out-of-scope items still owed from D110

These were explicitly deferred by P1's "what not to do" list:

- Startup validator over-broad (`ANTHROPIC_API_KEY` required even when
  no Claude agent is dispatched).
- Token banner false-positives on unrelated 401 paths.
- `act(...)` warnings against `TokenBanner` in Vitest.

All three remain Stage 2+ (or later) follow-ups.

## Status

**P1 merged.** Stage 2 (`P2-DASHBOARD-TRUTHFULNESS`) is now
unblocked and is the first stage that must dispatch through Ductum
rather than ship operator-direct.
