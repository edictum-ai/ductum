# Fix brief — Recovery review findings (Stream B)

> For a fix-worker (GPT 5.5 / GLM 5.2). Work in `/Users/acartagena/project/dn-recovery` on branch
> `stream/recovery` (deps installed; if DB tests fail on the native binding, run the repo's approved
> `better-sqlite3` build — it's in `pnpm.onlyBuiltDependencies`). Authorized internal work. **Do not push.**

## Context
The freeze/resume + provider-limit recovery engine is built and its 679 core tests pass (commits
`a63670b`, `5c948c6`, `3002c77`). But two adversarial-review passes surfaced **18 findings (~14 distinct)**,
mostly real logic bugs the tests don't cover. **Your job: fix them — all 4 HIGH for sure, then the
MEDIUM/LOW as cleanly as you can — add a test per fix, keep the suite green, and do NOT change the
fragile `refreshRunFromWorkflow` 'done' guard in `enforce.ts`.** Stay in dispatcher/recovery +
state-machine + the api wiring; no file >300 LOC; commit on `stream/recovery` (no AI mentions), no push.

## HIGH — must fix
1. **Resumed run loses the shared worktree on first crash** — `dispatcher-session.ts` / `dispatcher-spawn.ts`.
   A resumed run reuses worktree W but writes no checkpoint of its own (checkpoints only on *forward*
   advance; the seed step writes none because the run starts already at the resume stage). If it crashes
   before advancing, `cleanupFailedOwnWorktrees` deletes W — which the source run's checkpoint points at.
   Resume then survives only one crash. **Fix:** write an initial checkpoint at dispatch for resumed runs
   (`run.stage !== 'understand'`) in `recordSpawnedSession`.
2. **Operator resume/failover can re-run push/merge at `ship`** — `dispatcher-recovery.ts`
   `buildOperatorResumeOptions`. It gates only on worktree-on-disk + seed-hook, not `RESUMABLE_STAGES`, so a
   run paused/failed at `ship` re-seeds Edictum to `ship` and re-runs push/merge (design RISK 1: ship/merge
   must fall back to fresh). `isResumableCheckpoint` is imported but unused here. **Fix:** gate
   `buildOperatorResumeOptions` on `RESUMABLE_STAGES` (return `{}` otherwise → fresh).
3. **`resume()` has no concurrent-resume guard → split-brain** — `dispatcher-recovery.ts`. It doesn't check
   the task already has a live run, and doesn't transition the source out of `paused/frozen`, so calling it
   twice spawns two runs on one worktree (`dispatch()` skips the contested-worktree/hasActive guards that
   live in `cycle()`/`manualDispatch`). **Fix:** add a hasActive-per-task guard + task-not-done guard in
   `resume()`.
4. **Recoverable-external failover is unbounded** — `dispatcher-recovery.ts` `failover()`. It never
   increments `retryCount`/checks `maxTaskRetries` (unlike the transient path), so A→B→A→B ping-pong is
   possible when both providers fail. **Fix:** bound failover by the retry budget; freeze when exhausted.

## MEDIUM
5. **Stale stalled checkpoints never deleted** — `repos/run-checkpoint.ts` `delete()` has no callers. Wire
   cleanup (delete a superseded attempt's checkpoint).
6. **Exhausted/heartbeat-stalled worktrees pinned forever (disk leak)** — `dispatcher-resume.ts`
   `collectProtectedWorktrees` protects any stalled-resumable checkpoint, but a run whose task is already
   `failed` (heartbeat-stall no-retry, or retries exhausted) never resumes → its worktree is GC-protected
   indefinitely. **Fix:** gate protection on the task still being live (status not failed/done).
7. **Resume of an out-of-credits frozen run reuses the same exhausted agent** — `dispatcher-recovery.ts`
   resolves the agent from `run.agentId` (ignores health/busy) → immediate re-freeze. **Fix:** re-match the
   agent on resume (respect health/busy).
8. **Failover "different provider" keys on `harness`, not account/credentials** — `dispatcher-cycle.ts`
   `matchFailover`. Two agents can share an API key across harnesses (failover lands on the same exhausted
   account) or differ by account on the same harness (valid target skipped). `Agent` has no provider/account
   field. **Fix:** add a minimal `provider`/`account` field to `Agent` and key failover on it — OR, if that
   data-model change is too invasive for this pass, leave the harness heuristic and FLAG it clearly for a
   follow-up (don't half-do it).
9. **Failover marks the source `failed` (recoverable=false) before dispatch** — `dispatcher-recovery.ts`
   `failover()`. If the fallback dispatch throws, the source is unrecoverable. **Fix:** mark the source
   resumable, or only mark terminal after a successful dispatch.

## LOW
10. `pause()`/`resume()` can throw on a benign race with an in-flight `handleSessionEnd` that already stalled
    the run. No corruption — make it tolerant.
11. **API cost-budget precheck still `markFailed`** — `packages/api/src/lib/run-ops/cost-budget.ts`. Same
    budget condition lands `failed` here vs `frozen` from the runtime path → inconsistent state. Make it
    consistent (frozen/paused), so resume semantics match.
12. **Budget/turn freeze dropped the operator remediation text** — `dispatcher-session.ts`. The old
    "inspect…/retry…" failReason guidance is gone (legibility regression). Restore it.
13. **TOCTOU in `resolveInheritedWorktree`** — can throw if the worktree vanishes between the resume probe
    and the rebind (narrow window). Harden.

## Out of scope — do NOT fix here
14. `scoped-secret-broker.ts` warn-mode passes `secret:<id>` refs through unresolved. This is **expected**:
    warn mode = legacy behavior (which never resolved them); **enforce mode (now the default) DOES resolve
    them**. Not a bug. Leave it.

## Verify + report
Run `pnpm -C packages/core build`, `pnpm -C packages/core exec vitest run`, `pnpm -C packages/api build`,
`pnpm -C packages/api exec vitest run`, and `node scripts/check-file-size.mjs`. Add a test per HIGH fix
(e.g. resumed-run-crash keeps the worktree; ship-stage resume falls back to fresh; double-resume is
rejected; failover stops after the retry budget). Report: which findings you fixed vs flagged, the exact
build/test output (never claim pass unless you saw it), and any new judgment calls. Commit on
`stream/recovery`, no push.
