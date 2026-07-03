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
      this.stopWatchers(run.id, 'Parent run already awaiting approval')
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
      this.stopWatchers(event.runId, 'Parent run awaiting approval')
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
  return run.parentRunId != null
    && run.stage === 'understand'
    && !run.pendingApproval
    && run.sessionId == null
    && (run.worktreePaths?.length ?? 0) === 0
    && run.completedStages.length === 0
    && run.blockedReason == null
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
