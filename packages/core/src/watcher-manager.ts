import { DuctumEventEmitter, type DuctumEvent } from './events.js'
import type { EvidenceRepo, RunRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { AgentId, Run, RunId } from './types.js'
import {
  DEFAULT_CI_POLL_INTERVAL_MS,
  DEFAULT_CI_TIMEOUT_MS,
  DEFAULT_REVIEW_POLL_INTERVAL_MS,
  DEFAULT_REVIEW_TIMEOUT_MS,
  type WatcherCommandRunner,
} from './watcher.js'
import { CIWatcher } from './watchers/ci-watcher.js'
import { ReviewWatcher } from './watchers/review-watcher.js'

const STOP_STAGES = new Set(['implement', 'done'])

export interface WatcherManagerOptions {
  childAgentIdResolver?: (run: Run) => AgentId
  commandRunner?: WatcherCommandRunner
  now?: () => number
  ciPollIntervalMs?: number
  ciTimeoutMs?: number
  reviewPollIntervalMs?: number
  reviewTimeoutMs?: number
  /** Called when a watcher resolves — handles workflow reset on failure */
  onWatcherResolved?: (runId: RunId, type: 'ci' | 'review', passed: boolean) => Promise<void>
}

export class WatcherManager {
  private readonly activeWatchers = new Map<
    RunId,
    { commitSha: string; ci: CIWatcher; review: ReviewWatcher }
  >()
  private readonly unsubscribe: () => void

  constructor(
    private readonly runRepo: RunRepo,
    private readonly evidenceRepo: EvidenceRepo,
    private readonly stateMachine: RunStateMachine,
    private readonly eventEmitter: DuctumEventEmitter,
    private readonly options: WatcherManagerOptions = {},
  ) {
    this.unsubscribe = this.eventEmitter.subscribe((event) => {
      this.handleEvent(event)
    })
  }

  spawnWatchers(run: Run): void {
    if (run.pendingApproval) {
      this.cancelWatchers(run.id, 'Parent run already awaiting approval')
      this.closeEmptyWatcherChildren(run, 'Parent run already awaiting approval')
      return
    }
    if (run.stage !== 'ship' || run.terminalState != null) {
      return
    }
    if (isBlank(run.branch) || isBlank(run.commitSha) || isBlank(run.prUrl)) {
      return
    }
    const commitSha = run.commitSha as string
    const prUrl = run.prUrl as string
    const active = this.activeWatchers.get(run.id)
    if (active?.commitSha === commitSha) {
      return
    }
    this.stopWatchers(run.id, 'Replacing watchers')
    this.runRepo.updateLatchStatus(run.id, 'ciStatus', 'pending')
    this.runRepo.updateLatchStatus(run.id, 'reviewStatus', 'pending')
    const childAgentId = this.options.childAgentIdResolver?.(run) ?? run.agentId
    const deps = {
      runRepo: this.runRepo,
      evidenceRepo: this.evidenceRepo,
      stateMachine: this.stateMachine,
      eventEmitter: this.eventEmitter,
      onWatcherResolved: this.options.onWatcherResolved,
    }
    const watcherOptions = {
      childAgentId,
      commandRunner: this.options.commandRunner,
      now: this.options.now,
    }
    const ci = new CIWatcher(
      {
        type: 'ci',
        parentRunId: run.id,
        commitSha,
        pollIntervalMs: this.options.ciPollIntervalMs ?? DEFAULT_CI_POLL_INTERVAL_MS,
        timeoutMs: this.options.ciTimeoutMs ?? DEFAULT_CI_TIMEOUT_MS,
        prUrl,
      },
      deps,
      watcherOptions,
    )
    const review = new ReviewWatcher(
      {
        type: 'review',
        parentRunId: run.id,
        commitSha,
        pollIntervalMs: this.options.reviewPollIntervalMs ?? DEFAULT_REVIEW_POLL_INTERVAL_MS,
        timeoutMs: this.options.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
        prUrl,
      },
      deps,
      watcherOptions,
    )
    this.activeWatchers.set(run.id, { commitSha, ci, review })
    ci.start()
    review.start()
  }

  stopWatchers(runId: RunId, reason: string = 'Watchers stopped'): void {
    const watchers = this.activeWatchers.get(runId)
    if (watchers == null) {
      return
    }
    watchers.ci.stop(reason)
    watchers.review.stop(reason)
    this.activeWatchers.delete(runId)
  }

  /**
   * Cancel active watchers as bookkeeping instead of marking their child runs
   * `done`. Used on the approval path: when the parent run enters (or is
   * already in) approval, unsettled watcher children have no session, no
   * worktree, and no completed stages, so they must not be rendered as
   * successful implementation work. Each active watcher's child placeholder
   * is cancelled (`stage` stays at `understand`, `terminalState='cancelled'`,
   * `failReason` records the shutdown reason).
   */
  cancelWatchers(runId: RunId, reason: string = 'Watcher cancelled'): void {
    const watchers = this.activeWatchers.get(runId)
    if (watchers == null) {
      return
    }
    watchers.ci.cancel(reason)
    watchers.review.cancel(reason)
    this.activeWatchers.delete(runId)
  }

  activeCount(): number {
    return this.activeWatchers.size
  }

  dispose(): void {
    this.unsubscribe()
    for (const runId of [...this.activeWatchers.keys()]) {
      this.stopWatchers(runId, 'Watcher manager disposed')
    }
  }

  private handleEvent(event: DuctumEvent): void {
    if (event.type === 'run.awaiting_approval') {
      // Cancel active watcher children BEFORE cleanup so BaseWatcher cannot
      // mark no-lineage children `done` with the approval shutdown reason —
      // such invalid `done` rows would otherwise become the newest run for
      // the task and block operator retry/redirect on the real parent.
      this.cancelWatchers(event.runId, 'Parent run awaiting approval')
      this.closeEmptyWatcherChildren(event.runId, 'Parent run awaiting approval')
      return
    }
    if (event.type !== 'run.stage_changed') {
      return
    }
    if (event.to === 'ship') {
      const run = this.runRepo.get(event.runId)
      if (run != null) {
        this.spawnWatchers(run)
      }
      return
    }
    if (STOP_STAGES.has(event.to)) {
      this.stopWatchers(event.runId, `Parent run entered ${event.to}`)
    }
  }

  private closeEmptyWatcherChildren(parent: Run | RunId, reason: string): void {
    const parentRun = typeof parent === 'string' ? this.runRepo.get(parent) : parent
    if (parentRun == null) return
    const childRuns = this.runRepo.list(parentRun.taskId).filter((run) => isEmptyWatcherChild(parentRun, run))
    for (const child of childRuns) {
      // Cancel placeholder children: they never produced real work and must
      // not look like a successful `done` run. Leaving `stage` at 'understand'
      // keeps the placeholder out of completion-evidence evaluation while
      // `terminalState='cancelled'` records that the placeholder was retired.
      this.runRepo.updateTerminalState(child.id, 'cancelled')
      this.runRepo.updateFailure(child.id, reason, false)
    }
  }
}

function isBlank(value: string | null): boolean {
  return value == null || value.trim() === ''
}

/**
 * Watcher shutdown reasons that indicate a child run was retired as
 * bookkeeping, not as real implementation work. Used to recognize historical
 * invalid `done` rows produced by older `BaseWatcher.stop()` paths that
 * marked no-lineage children `done` before cleanup could cancel them.
 */
const WATCHER_SHUTDOWN_REASONS = new Set([
  'Parent run awaiting approval',
  'Parent run already awaiting approval',
  'Replacing watchers',
  'Watcher manager disposed',
  'Watcher stopped',
  'Watcher cancelled',
])

function isWatcherShutdownReason(reason: string | null): boolean {
  if (reason == null) {
    return false
  }
  if (WATCHER_SHUTDOWN_REASONS.has(reason)) {
    return true
  }
  // `Parent run entered ${stage}` reasons from the STOP_STAGES path
  // (e.g. 'Parent run entered implement', 'Parent run entered done').
  return reason.startsWith('Parent run entered ')
}

/**
 * Common shape of a no-lineage watcher child: parent-linked, no session, no
 * worktree, no completed stages, no pending approval, and no recorded
 * blockage. Such a run never produced real implementation work. The two
 * exported shapes below compose this with their stage/terminal conditions.
 */
function isNoLineageWatcherChild(run: Run): boolean {
  return run.parentRunId != null
    && !run.pendingApproval
    && run.sessionId == null
    && (run.worktreePaths?.length ?? 0) === 0
    && run.completedStages.length === 0
    && run.blockedReason == null
}

/**
 * Parent-agnostic shape of an empty watcher placeholder: a child run with no
 * session, no worktree, no completed stages, no pending approval, and no
 * recorded blockage. The check is intentionally terminal-state agnostic so
 * callers can compose it: the watcher manager looks for active placeholders
 * (`terminalState == null`) to retire, while operator latest-run guards
 * skip any matching placeholder regardless of terminal state because such a
 * run never produced real implementation work.
 *
 * Real watcher children that actually polled still match this shape — that
 * is intentional, because they also lack lineage and must not be treated as
 * successful implementation work outside the watcher lifecycle.
 */
export function isEmptyWatcherPlaceholderRun(run: Run): boolean {
  return isNoLineageWatcherChild(run) && run.stage === 'understand'
}

/**
 * Historical invalid `done` watcher bookkeeping row: a parent-linked child
 * with no lineage that was marked `stage: 'done'` by an older
 * `BaseWatcher.stop()` path (before cancellation-on-approval landed) and
 * carries a watcher/approval shutdown `failReason`. Such a row is
 * bookkeeping, not implementation evidence, and must not become the newest
 * `done` run for the task — otherwise it blocks operator retry/redirect on
 * the real parent run indefinitely.
 *
 * Real newer runs with actual lineage (session, worktree, completed stages)
 * do not match this shape and still block stale parent actions.
 */
export function isInvalidDoneWatcherBookkeepingRun(run: Run): boolean {
  return isNoLineageWatcherChild(run)
    && run.stage === 'done'
    && run.terminalState == null
    && run.completionSummary == null
    && isWatcherShutdownReason(run.failReason)
}

function isEmptyWatcherChild(parent: Run, run: Run): boolean {
  return isEmptyWatcherPlaceholderRun(run)
    && run.terminalState == null
    && run.parentRunId === parent.id
    && run.branch === parent.branch
    && run.commitSha === parent.commitSha
    && run.prNumber === parent.prNumber
    && run.prUrl === parent.prUrl
}
