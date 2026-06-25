import { AgentRuntimeResolutionError } from './agent-runtime-resolution.js'
import {
  type DispatchResult,
  toErrorMessage,
} from './dispatcher-support.js'
import type { DispatchOptions } from './dispatcher-types.js'
import { resolveResumeOptions } from './dispatcher-resume.js'
import { DispatcherRuntime } from './dispatcher-runtime.js'
import { log } from './logger.js'
import { classifyTask } from './post-completion-router.js'
import type { Agent, Task } from './types.js'

export abstract class DispatcherCycle extends DispatcherRuntime {
  async cycleOnce(): Promise<DispatchResult> {
    if (this.inFlightCycle != null) return await this.inFlightCycle
    const cycle = this.runManagedCycle()
    this.inFlightCycle = cycle
    try {
      return await cycle
    } finally {
      if (this.inFlightCycle === cycle) this.inFlightCycle = null
      if (this.pendingImmediateCycle && this.running && this.resolvedConfig.enabled) {
        this.pendingImmediateCycle = false
        queueMicrotask(() => this.kick())
      }
    }
  }

  async cycle(): Promise<DispatchResult> {
    this.lastCycleAt = this.now().toISOString()
    this.cycleCount++
    const result: DispatchResult = { tasksEvaluated: 0, tasksDispatched: [], errors: [] }

    await this.checkStalled()
    if (this.forceCleanupOnNextCycle || this.cycleCount % 10 === 0) {
      const force = this.forceCleanupOnNextCycle
      this.forceCleanupOnNextCycle = false
      await this.cleanupStaleWorktrees({ force })
    }
    if (!this.resolvedConfig.enabled) return result

    const activeSessionCount = this.activeSessions.size
    if (activeSessionCount >= this.resolvedConfig.maxConcurrentRuns) return result

    const slotsAvailable = this.resolvedConfig.maxConcurrentRuns - activeSessionCount
    const nowMs = this.now().getTime()
    for (const task of this.taskRepo.getReady()) {
      if (result.tasksDispatched.length >= slotsAvailable) break
      if (task.retryAfter != null && new Date(task.retryAfter).getTime() > nowMs) {
        this.emitDispatchSkip(task.id, 'retry-backoff', `waiting until ${task.retryAfter}`)
        continue
      }

      result.tasksEvaluated++

      try {
        const options = this.resolveDispatchOptions(task)
        const agent = this.matchAgentForOptions(task, options)
        if (agent == null) {
          if (this.hasBusyEligibleAgentForOptions(task, options)) {
            this.emitDispatchSkip(task.id, 'agent-busy', 'eligible agent busy in another run')
            continue
          }
          this.clearDispatchSkip(task.id)
          result.errors.push({ taskId: task.id, error: 'No available agent matches task' })
          continue
        }

        if (this.isWorktreeContested(task, options)) {
          this.emitDispatchSkip(task.id, 'worktree-contention', 'worktree held by an in-flight run')
          continue
        }
        await this.dispatch(task, agent, options)
        result.tasksDispatched.push(task.id)
      } catch (error) {
        this.clearDispatchSkip(task.id)
        result.errors.push({ taskId: task.id, error: toErrorMessage(error) })
        if (error instanceof AgentRuntimeResolutionError) {
          this.taskRepo.updateStatus(task.id, 'failed')
        }
      }
    }

    return result
  }

  protected async tick(): Promise<void> {
    try {
      await this.cycleOnce()
    } catch (error) {
      log.error('dispatcher', `tick failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  protected kick(): void {
    if (!this.running || !this.resolvedConfig.enabled) return
    if (this.inFlightCycle != null) {
      this.pendingImmediateCycle = true
      return
    }
    void this.tick()
  }

  protected async runManagedCycle(): Promise<DispatchResult> {
    const result = await this.cycle()
    if (result.tasksDispatched.length > 0) {
      log.info('dispatcher', `dispatched ${result.tasksDispatched.length} task(s)`)
    }
    for (const dispatched of result.tasksDispatched) {
      this.lastLoggedErrors.delete(dispatched)
      this.clearDispatchSkip(dispatched)
    }
    for (const err of result.errors) {
      const previous = this.lastLoggedErrors.get(err.taskId)
      if (previous === err.error) continue
      this.lastLoggedErrors.set(err.taskId, err.error)
      const task = this.taskRepo.get(err.taskId)
      const label = task != null ? `${task.name} (${err.taskId})` : err.taskId
      log.error('dispatcher', `error for task ${label}: ${err.error}`)
    }
    return result
  }

  /** Emit and persist a deduped task.dispatch_skipped reason per task. */
  private emitDispatchSkip(taskId: Task['id'], reason: string, detail: string): void {
    if (this.lastSkipLogged.get(taskId) === reason) return
    this.lastSkipLogged.set(taskId, reason)
    this.recordDispatchSkip(taskId, reason, detail)
    this.eventEmitter.emit({ type: 'task.dispatch_skipped', taskId, reason, detail })
  }

  private recordDispatchSkip(taskId: Task['id'], reason: string, detail: string): void {
    try {
      this.taskDispatchSkipRepo?.record({ taskId, reason, detail, skippedAt: this.now().toISOString() })
    } catch (error) {
      log.warn('dispatcher', `failed to persist dispatch skip for ${taskId}: ${toErrorMessage(error)}`)
    }
  }

  private clearDispatchSkip(taskId: Task['id']): void {
    this.lastSkipLogged.delete(taskId)
    try {
      this.taskDispatchSkipRepo?.clear(taskId)
    } catch (error) {
      log.warn('dispatcher', `failed to clear dispatch skip for ${taskId}: ${toErrorMessage(error)}`)
    }
  }

  protected resolveDispatchOptions(task: Task): DispatchOptions {
    const intent = this.router.resolveDispatchIntent(task)
    // Fix/review lineage owns its own worktree + parent; never override it
    // with a crash-resume.
    if (intent.reuseWorktreeFromRunId != null || intent.parentRunId != null) return intent
    const resume = resolveResumeOptions(
      this.runCheckpointRepo,
      task,
      this.resolvedConfig.seedWorkflowStage != null,
    )
    return resume == null ? intent : { ...intent, ...resume }
  }

  protected matchAgentForOptions(task: Task, options: DispatchOptions): Agent | null {
    if (options.reuseWorktreeFromRunId == null || options.resumeFromStage == null) return this.matchAgent(task)
    const sourceRun = this.runRepo.get(options.reuseWorktreeFromRunId)
    if (sourceRun == null) return this.matchAgent(task)
    const source = this.resolveRuntimeAgentForRun(sourceRun) ?? this.agentRepo.get(sourceRun.agentId)
    if (source != null && this.isAgentAvailableForDispatch(source)) return source
    if (source != null && this.isAgentBusy(source)) return null
    return this.matchAgent(task)
  }

  protected hasBusyEligibleAgentForOptions(task: Task, options: DispatchOptions): boolean {
    const sourceRun = options.reuseWorktreeFromRunId == null || options.resumeFromStage == null
      ? null
      : this.runRepo.get(options.reuseWorktreeFromRunId)
    const source = sourceRun == null ? null : this.resolveRuntimeAgentForRun(sourceRun) ?? this.agentRepo.get(sourceRun.agentId)
    return (source != null && this.isAgentBusy(source)) || this.hasBusyEligibleAgent(task)
  }

  protected matchAgent(task: Task): Agent | null {
    if (task.assignedAgentId != null) {
      const agent = this.agentRepo.get(task.assignedAgentId)
      if (agent == null || !this.isAgentAvailableForDispatch(agent)) return null
      return agent
    }

    const spec = this.specRepo.get(task.specId)
    if (spec == null) throw new Error(`Spec not found: ${task.specId}`)

    const targetRole = task.requiredRole ?? 'builder'
    const candidates: Agent[] = []
    for (const assignment of this.projectAgentRepo.getByRole(spec.projectId, targetRole)) {
      const agent = this.agentRepo.get(assignment.agentId)
      if (agent != null && this.isAgentAvailableForDispatch(agent)) candidates.push(agent)
    }
    if (candidates.length === 0) return null
    if (task.complexity === 'complex') {
      candidates.sort((a, b) => b.costTier - a.costTier)
    } else {
      candidates.sort((a, b) => a.costTier - b.costTier)
    }
    return candidates[0] ?? null
  }

  /**
   * Pick a same-role agent with a different provider/account identity than
   * the failed one. Legacy agents without identity keep the old harness
   * fallback, but harness is not treated as a durable provider identity.
   */
  protected matchFailoverAgent(task: Task, failedAgent: Agent): Agent | null {
    const spec = this.specRepo.get(task.specId)
    if (spec == null) return null
    const targetRole = task.requiredRole ?? 'builder'
    const candidates: Agent[] = []
    for (const assignment of this.projectAgentRepo.getByRole(spec.projectId, targetRole)) {
      if (assignment.agentId === failedAgent.id) continue
      const agent = this.agentRepo.get(assignment.agentId)
      if (agent == null || !this.isAgentAvailableForDispatch(agent)) continue
      const identityMatch = sameProviderAccountIdentity(agent, failedAgent)
      if (identityMatch === true) continue
      if (identityMatch == null && agent.harness === failedAgent.harness) continue
      candidates.push(agent)
    }
    candidates.sort((a, b) => a.costTier - b.costTier)
    return candidates[0] ?? null
  }

  protected hasBusyEligibleAgent(task: Task): boolean {
    if (task.assignedAgentId != null) {
      const agent = this.agentRepo.get(task.assignedAgentId)
      return agent != null && this.isAgentBusy(agent)
    }
    const spec = this.specRepo.get(task.specId)
    if (spec == null) return false
    const targetRole = task.requiredRole ?? 'builder'
    return this.projectAgentRepo.getByRole(spec.projectId, targetRole).some((assignment) => {
      const agent = this.agentRepo.get(assignment.agentId)
      return agent != null && this.isAgentBusy(agent)
    })
  }

  protected isAgentAvailableForDispatch(agent: Agent): boolean {
    return !this.isAgentBusy(agent) && !this.shouldSkipUnhealthyAgent(agent)
  }

  protected isAgentBusy(agent: Agent): boolean {
    return [...this.activeSessions.values()].some((entry) => entry.agentId === agent.id)
  }

  protected isWorktreeContested(task: Task, options: DispatchOptions): boolean {
    const parsed = classifyTask(task)
    if (parsed.kind === 'impl') return false
    for (const [runId] of this.activeSessions) {
      const run = this.runRepo.get(runId)
      if (run == null) continue
      const runTask = this.taskRepo.get(run.taskId)
      if (runTask == null || runTask.specId !== task.specId) continue
      const runParsed = classifyTask(runTask)
      const runOriginal = runParsed.kind === 'impl' ? runTask.name : runParsed.originalName
      if (runOriginal === parsed.originalName) return true
    }
    if (options.reuseWorktreeFromRunId != null) {
      const sourceRun = this.runRepo.get(options.reuseWorktreeFromRunId)
      const sourcePaths = sourceRun?.worktreePaths ?? []
      if (sourcePaths.length > 0) {
        for (const [runId] of this.activeSessions) {
          const activeRun = this.runRepo.get(runId)
          for (const p of activeRun?.worktreePaths ?? []) {
            if (sourcePaths.includes(p)) return true
          }
        }
      }
    }
    return false
  }
}

function sameProviderAccountIdentity(candidate: Agent, failed: Agent): boolean | null {
  const candidateIdentity = providerAccountIdentity(candidate)
  const failedIdentity = providerAccountIdentity(failed)
  if (candidateIdentity == null || failedIdentity == null) return null
  return candidateIdentity.providerId === failedIdentity.providerId
    && candidateIdentity.accountId === failedIdentity.accountId
}

function providerAccountIdentity(agent: Agent): { providerId: string; accountId: string } | null {
  const providerId = normalizeIdentityPart(agent.providerId)?.toLowerCase()
  const accountId = normalizeIdentityPart(agent.accountId)
  return providerId == null || accountId == null ? null : { providerId, accountId }
}

function normalizeIdentityPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? null : trimmed
}
