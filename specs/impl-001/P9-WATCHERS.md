# P9: Watcher System

**Scope:** CI and review watchers, evidence injection, parallel latch resolution
**Package:** `packages/core`
**Depends on:** P2 (state machine — parallel latches, resolveLatch), P4 (REST API)
**Deliverable:** Watcher spawning, CI polling, review monitoring, evidence injection, latch resolution
**Verification:** `cd packages/core && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §11 (Watcher System)
- `VISION.md` §Watcher ("A lightweight agent that monitors external state and reports back")
- `VISION.md` §Run sub-states: waiting-for-ci, waiting-for-review (parallel latches)
- `ARCHITECTURE.md` §Run state machine (parallel latch diagram)
- `decisions/005-round-2-response.md` §D16 (CI and review are parallel latches)
- `OPEN-QUESTIONS.md` §Q8 (watcher authority — watchers inject evidence, Ductum Core decides)

## Shared Modules (import from P1, P2)

| What | Where |
|------|-------|
| Run, RunStage, Evidence types | `packages/core/src/types.ts` |
| RunRepo, EvidenceRepo | `packages/core/src/repos/` |
| RunStateMachine (resolveLatch, reset) | `packages/core/src/state-machine.ts` |
| DuctumEventEmitter | `packages/core/src/events.ts` |

## Tasks

### 1. Define watcher types

File: `packages/core/src/watcher.ts` (types section)

```typescript
type WatcherType = 'ci' | 'review'

interface WatcherConfig {
  type: WatcherType
  parentRunId: RunId
  commitSha: string        // commit SHA to monitor (D26 — used for dedup)
  pollIntervalMs: number   // default: 30_000 for CI, 60_000 for review
  timeoutMs: number        // default: 1_800_000 (30 min)
  prUrl: string            // PR to monitor
}

interface CICheckResult {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'neutral' | 'skipped' | 'timed_out' | null
}

interface ReviewResult {
  reviewer: string
  status: 'approved' | 'changes_requested' | 'commented' | 'pending'
  findings: string[]
}
```

### 2. Implement CI watcher

File: `packages/core/src/watcher.ts`

```typescript
class CIWatcher {
  private timer: NodeJS.Timeout | null = null
  private startedAt: number
  readonly childRunId: RunId  // watcher is a child run in the DB (D26)

  constructor(
    private config: WatcherConfig,
    private runRepo: RunRepo,
    private evidenceRepo: EvidenceRepo,
    private stateMachine: RunStateMachine,
    private eventEmitter: DuctumEventEmitter,
  )

  // Start polling CI status. Creates child Run record in DB (D26).
  start(): void {
    this.startedAt = Date.now()
    // Create child run for cost tracking and audit trail
    this.runRepo.create({
      id: this.childRunId,
      taskId: /* parent's taskId */,
      agentId: /* watcher agent (e.g., haiku) */,
      parentRunId: this.config.parentRunId,
      stage: 'accepted',
      // ... other fields
    })
    this.timer = setInterval(() => this.poll(), this.config.pollIntervalMs)
    this.poll()  // immediate first check
  }

  // Stop polling
  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async poll(): Promise<void> {
    // 1. Check timeout
    if (Date.now() - this.startedAt > this.config.timeoutMs) {
      this.stop()
      await this.resolveWithTimeout()
      return
    }

    // 2. Run: gh pr checks <prUrl> --json name,state,conclusion
    const checks = await this.fetchCIChecks()

    // 3. If all checks completed:
    //    a. Inject evidence
    //    b. Resolve latch
    if (checks.every(c => c.status === 'completed')) {
      this.stop()
      const allPassed = checks.every(c =>
        c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped'
      )
      await this.resolve(allPassed, checks)
    }
    // 4. If still running: continue polling
  }

  private async fetchCIChecks(): Promise<CICheckResult[]> {
    // Execute: gh pr checks <prUrl> --json name,state,conclusion
    // Parse JSON output
    // Return structured results
  }

  private async resolve(passed: boolean, checks: CICheckResult[]): Promise<void> {
    // 0. Validate commit SHA matches parent's current commit (D26)
    //    Discards stale signals from previous push cycles
    const parentRun = this.runRepo.get(this.config.parentRunId)
    if (parentRun && parentRun.commitSha !== this.config.commitSha) {
      // Stale signal — parent has re-pushed with a new commit
      // Mark child run as done and discard
      this.runRepo.updateStage(this.childRunId, 'done', 'Stale commit SHA')
      return
    }

    // 1. Attach evidence to parent run (includes commit SHA for audit)
    await this.evidenceRepo.create({
      id: createId(),
      runId: this.config.parentRunId,
      type: 'ci',
      payload: { passed, checks, commitSha: this.config.commitSha, resolvedAt: new Date().toISOString() },
    })

    // 2. Mark watcher child run as done
    this.runRepo.updateStage(this.childRunId, 'done', passed ? 'CI passed' : 'CI failed')

    // 3. Resolve the CI latch on the parent run
    await this.stateMachine.resolveLatch(
      this.config.parentRunId,
      'ci',
      passed ? 'pass' : 'fail',
    )
  }

  private async resolveWithTimeout(): Promise<void> {
    await this.evidenceRepo.create({
      id: createId(),
      runId: this.config.parentRunId,
      type: 'ci',
      payload: { passed: false, reason: 'CI timed out', resolvedAt: new Date().toISOString() },
    })
    await this.stateMachine.resolveLatch(this.config.parentRunId, 'ci', 'fail')
  }
}
```

### 3. Implement review watcher

File: `packages/core/src/watcher.ts` (same file, keep under 300 LOC — split if needed)

```typescript
class ReviewWatcher {
  // Similar structure to CIWatcher but monitors PR reviews

  private async poll(): Promise<void> {
    // 1. Check timeout
    // 2. Run: gh pr reviews <prUrl> --json author,state,body
    // 3. Parse review status:
    //    - 'approved' with no 'changes_requested' -> pass
    //    - 'changes_requested' -> fail with findings
    //    - No reviews yet -> continue polling
  }

  private async resolve(passed: boolean, review: ReviewResult): Promise<void> {
    // 1. Attach evidence
    await this.evidenceRepo.create({
      id: createId(),
      runId: this.config.parentRunId,
      type: 'review',
      payload: { passed, review, resolvedAt: new Date().toISOString() },
    })

    // 2. Resolve the review latch
    await this.stateMachine.resolveLatch(
      this.config.parentRunId,
      'review',
      passed ? 'pass' : 'fail',
    )
  }
}
```

### 4. Watcher manager

File: `packages/core/src/watcher-manager.ts`

```typescript
class WatcherManager {
  private activeWatchers: Map<RunId, { ci?: CIWatcher; review?: ReviewWatcher }> = new Map()

  constructor(
    private runRepo: RunRepo,
    private evidenceRepo: EvidenceRepo,
    private stateMachine: RunStateMachine,
    private eventEmitter: DuctumEventEmitter,
  )

  // Spawn both watchers when a run enters parallel latch state
  spawnWatchers(run: Run): void {
    const ciWatcher = new CIWatcher({
      type: 'ci',
      parentRunId: run.id,
      commitSha: run.commitSha!,  // D26: commit SHA for dedup
      pollIntervalMs: 30_000,
      timeoutMs: 1_800_000,
      prUrl: run.prUrl!,
    }, this.runRepo, this.evidenceRepo, this.stateMachine, this.eventEmitter)

    const reviewWatcher = new ReviewWatcher({
      type: 'review',
      parentRunId: run.id,
      commitSha: run.commitSha!,  // D26: commit SHA for dedup
      pollIntervalMs: 60_000,
      timeoutMs: 3_600_000,
      prUrl: run.prUrl!,
    }, this.runRepo, this.evidenceRepo, this.stateMachine, this.eventEmitter)

    ciWatcher.start()
    reviewWatcher.start()

    this.activeWatchers.set(run.id, { ci: ciWatcher, review: reviewWatcher })
  }

  // Stop watchers for a run (run was reset or completed)
  stopWatchers(runId: RunId): void {
    const watchers = this.activeWatchers.get(runId)
    if (watchers) {
      watchers.ci?.stop()
      watchers.review?.stop()
      this.activeWatchers.delete(runId)
    }
  }

  // Get active watcher count (for status reporting)
  activeCount(): number {
    return this.activeWatchers.size
  }
}
```

### 5. Integrate watcher spawning with state machine

When `RunStateMachine.enterParallelLatches(runId)` is called (after pushing), the state machine should notify the WatcherManager to spawn watchers. This can be done via:
- Event: state machine emits `run.stage_changed` with to='waiting-for-ci' -> WatcherManager listens
- Direct call: state machine has a reference to WatcherManager

Use the event-based approach for looser coupling.

### 6. Duplicate signal handling

In `resolveLatch()` (state machine, from P2): if a latch is already resolved (ci_status is already 'pass' or 'fail'), ignore the duplicate signal. Log a warning.

Deduplication key: the latch field itself (ci_status / review_status). First write wins.

### 7. Tests

File: `packages/core/src/tests/watcher.test.ts`

Mock `gh pr checks` and `gh pr reviews` shell commands:

**CI Watcher:**
- All checks pass -> evidence attached, ci latch resolved as 'pass'
- Any check fails -> evidence attached, ci latch resolved as 'fail'
- Checks still running -> watcher continues polling (verify poll count)
- Timeout -> evidence attached with timeout reason, ci latch resolved as 'fail'
- Watcher stops after resolution (no more polls)

**Review Watcher:**
- Approved review -> evidence attached, review latch resolved as 'pass'
- Changes requested -> evidence attached, review latch resolved as 'fail'
- No reviews yet -> watcher continues polling

**Latch resolution integration:**
- CI pass + review pass -> both latches resolved, merge gate evaluation triggered
- CI fail -> parent run reset to 'fixing' (even if review hasn't resolved yet)
- Review fail -> parent run reset to 'fixing'
- Duplicate CI signal ignored (first write wins)

**Watcher manager:**
- spawnWatchers creates both CI and review watchers
- stopWatchers stops both and cleans up
- activeCount returns correct count

## Verification Checklist

- [ ] `pnpm test` in packages/core — all watcher tests pass
- [ ] CI watcher polls `gh pr checks` at configured interval
- [ ] Review watcher polls PR reviews at configured interval
- [ ] Evidence injected for both pass and fail outcomes
- [ ] Latch resolution triggers correct state machine transitions
- [ ] Both latches passing triggers merge gate evaluation
- [ ] Either latch failing resets run to fixing
- [ ] Timeout handling works for both watchers
- [ ] Duplicate signals are ignored (first write wins)
- [ ] **Stale commit SHA signals are discarded (D26)**
- [ ] **Watchers create child Run records in DB for cost tracking (D26)**
- [ ] On fix-repush: old watchers stopped, new ones spawned with new commit SHA
- [ ] WatcherManager cleans up watchers on stop (child runs marked done)
- [ ] Watchers do NOT directly trigger resets — they inject evidence, state machine decides (Q8)
