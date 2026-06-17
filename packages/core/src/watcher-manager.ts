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
}

function isBlank(value: string | null): boolean {
  return value == null || value.trim() === ''
}
