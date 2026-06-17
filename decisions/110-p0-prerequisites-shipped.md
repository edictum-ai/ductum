# D110: Factory Readiness Recovery — Stage 0 (P0 Prerequisites) shipped

**Date:** 2026-04-30
**Decided by:** Arnold + Claude Opus
**Supersedes:** —
**Linked spec:** `specs/current/factory-readiness-recovery/P0-PREREQUISITES.md`
**Linked task:** `QWrBGbk_i2Zo` (P0-PREREQUISITES, project ductum, spec factory-readiness-recovery)

## Context

D109 named six gaps the 2026-04-30 audit exposed. P0 (the operator-direct
prerequisites stage) is the gating item: until it merged on `main`, the
later stages could not be dispatched through Ductum without working CLI
parity, working spec-status semantics, working run URLs, working tasks
visibility, and a working first-run dashboard.

This decision records the operator-direct merge as evidence, since there
is currently no clean "operator-direct task complete" CLI for `ductum
task` — itself a Stage 1 follow-up to expose.

## P0 deliverables (with commits)

All commits on `main`, pushed to origin.

| # | Item                                          | Commit    |
|---|-----------------------------------------------|-----------|
| 0.4 | `SpecStatus = 'failed'` enum + `ductum spec set-status` CLI | `cdbecf0` |
| 0.5 | `ductum run end-session` + `ductum project agent assign\|unassign\|list` | `26c8a19` |
| 0.2 | `SpecList.tsx` mislabel: trust stored `spec.status` over derived run failures | `ad4a846` |
| 0.3 | `/runs/<id>` deep-link redirect + `Run not found` error page | `606293d` |
| 0.1 | Operator-token banner with loopback auto-detect + Verify-token | `7628613` |
| —   | `specs.status` CHECK constraint widening migration (P0.4 follow-up) | `a9cb566` |
| —   | `/api/resolve/runs/:runId` ordering fix (P0.3 follow-up)             | `3e9c146` |
| —   | Type-assert reverse-resolve fixture json                              | `7671a53` |

## Exit-demo evidence

Verified manually with a live `pnpm serve` and the chrome-devtools MCP
on 2026-04-30:

1. **Token UX.** Loaded `http://localhost:5176/specs` with no token in
   localStorage. Banner rendered with the file hint and Auto-detect
   button. Click populated localStorage from
   `/api/internal/operator-token-detect`, page reloaded, dashboard
   rendered.
2. **Spec list.** `agent-first-factory-readiness` rendered as **done**
   (green), header read `2 specs · 1 done · 1 draft`. Under "Needs
   attention" the two flipped specs rendered as **failed** with header
   `2 specs · 2 failed`.
3. **Run URL.** `node packages/cli/dist/index.js status Pu10mRIWUQjf`
   printed `url: http://localhost:5176/runs/Pu10mRIWUQjf`. Pasting that
   URL redirected to `/ductum/agent-first-factory-readiness/pi-sdk-spike-adapter/Pu10mR`.
   `/runs/totally-fake-run-id` rendered "Run not found", not "Spec X
   could not be resolved".
4. **Spec set-status.** `ductum spec set-status sW6DepIBwijp failed` and
   `ductum spec set-status UwdJRnGtoMKP failed` flipped both specs;
   `ductum spec list ductum` confirmed `failed` status; the dashboard
   "Needs attention" filter listed both.
5. **CLI parity.** `ductum run end-session Pu10mRIWUQjf` reported
   "Requested session teardown for run Pu10mRIWUQjf"; `ductum project
   agent assign ductum codex --role builder` round-tripped without
   curl; `ductum project agent list ductum` listed all assignments.
6. **Quality gates.** `pnpm build`, `pnpm -r test`, `pnpm test:scripts`,
   `git diff --check` all clean before each push.

## Follow-ups (Stage 1+)

- **No operator-direct "task complete" CLI.** This decision is the only
  durable record that QWrBGbk_i2Zo (P0-PREREQUISITES) is finished;
  the task row in SQLite is still `ready`. Stage 1's `ductum-cli`
  skill should expose `ductum task complete <taskId>` for this exact
  case. Until then, future stage closures repeat this pattern: a
  decision file plus the README status flip.
- **Dashboard hot-reload during dev.** The `pnpm serve` API blocked
  startup with a `Startup validation failed` error because no
  `ANTHROPIC_API_KEY` was present in `.env.local`, even though no
  agent that needs it was running. Verification proceeded with a
  placeholder env; surface-level fix is to scope the validator to
  agents that will actually be dispatched.
- **TokenBanner act() warnings.** The Vitest run logs two
  `act(...)` warnings against `TokenBanner` for the auto-detect and
  storage-event paths. Tests pass; clean up when the next dashboard
  test pass touches the file.
- **Token banner false-positive.** The slop-review note ("attack a
  banner that fires on every 401") is honored today by gating on
  `operatorTokenProtected` *plus* either no token or an auth-error
  event. Future runs may see banner flicker when other 401 reasons
  exist (e.g. session-control endpoints) — revisit if reported.

## Status

**P0 merged.** Stage 1 (`ductum-cli` skill) is now unblocked. Update
`specs/current/factory-readiness-recovery/README.md` to mark row 0 as
done.
