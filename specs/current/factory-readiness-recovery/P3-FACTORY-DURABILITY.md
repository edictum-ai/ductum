# P3 - Factory Durability (dogfood)

## Problem

The factory cannot survive its most basic operational events:

- Every `pnpm serve` restart orphans live runs (in-memory `activeSessions`
  map is process-local). We hit this 3× on 2026-04-30; each recovery
  required manual `end-session` + rebase + re-verify + re-approve.
- Approval gate requires the branch to contain current main. Every
  concurrent merge breaks the next approval and forces a manual rebase.
- The strict P18 verdict parser rejects every reviewer that mixes a
  verdict into prose. Codex always does this. Other LLMs do it often.
  P19 needed three retries plus the new `operator-ship` endpoint to
  recover.
- `perSpecHardUsd: 100` shipped as the default; `agent-first-factory-readiness`
  burned $145, blocking new dispatches until the cap was raised.

## Scope

Dispatched through Ductum. Each behavior contract bullet is one task.

## Behavior Contract

### 3.1 `persistent-session-binding`

- Persist `activeSessions` across `pnpm serve` restarts. On startup,
  reattach by `sessionId` from the `session_run_mappings` table for
  any harness that supports session reattach (codex-sdk via app-server,
  claude-agent-sdk via SDK session id).
- For harnesses that cannot reattach (no API), mark the run stalled
  with explicit reason "harness session not reattachable across server
  restart" rather than silently orphaning.
- D27 (one WorkflowRuntime per run) still holds.

### 3.2 `approval-auto-rebase`

- When `ductum approve` hits the stale-branch gate, the dashboard
  approval card and the CLI both offer a single `--rebase` action that
  rebases the worktree onto current main, re-runs verify, re-links the
  new commit, and re-approves.
- If rebase produces conflicts, dispatch a fix-rebase task to the
  original implementer (already exists for impl runs; extend to
  approval-time rebase).
- Record an evidence row capturing pre/post commits and verify result.

### 3.3 `reviewer-format-compat`

- Either widen `parseReviewResult` to accept a verdict at the start of
  the completion text (`PASS:` / `WARN:` / `FAIL:` followed by prose)
  while keeping last-line strictness as fallback, OR pre-fill
  `## Final verdict\n` in the review prompt so any LLM puts the
  verdict where the parser looks. Pick after a brief A/B with the
  current four reviewer agents.
- The chosen approach must be documented in a Decision under `decisions/`
  with the A/B evidence.
- Codex review of a representative diff must produce a parseable verdict
  on first try, not after three retries.

### 3.4 `spec-budget-realism`

- Default `perSpecHardUsd` rises to a value supported by observed spec
  cost (today's reality is ~$150 per spec). Pick after measuring the
  three most recent specs.
- Dashboard surfaces projected spend per spec so operators see the
  trajectory before they hit the cap.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
```

Plus operational tests:

- Mid-flight `pkill -f serve && pnpm serve` resumes the in-flight run.
- `ductum approve` + stale main → `--rebase` → merge in one operator
  click sequence.
- Codex review of P19's diff produces a PASS verdict the parser accepts
  on first try.
- `ductum cost --spec <id>` prints projected vs configured cap.

## Exit Demo

1. I dispatch a real task, mid-implement I `pkill -f serve` and `pnpm serve`.
   The run resumes, hits review, lands.
2. While that's running, I cause a concurrent merge on main, then approve
   the run with `--rebase`. It rebases, re-verifies, re-approves, merges.
   No manual operator intervention.
3. `parseReviewResult` test suite includes the actual reviewer outputs
   we collected on 2026-04-30; all pass.

## Slop Review

- Attack 3.1 if it relies on harness state we cannot serialize. The
  fallback path (mark stalled with explicit reason) must exist.
- Attack 3.3 if it loosens the parser without an A/B that proves the
  loosening doesn't admit malformed output as PASS.
- Attack 3.4 if the new default cap is plucked from air rather than
  measured.
