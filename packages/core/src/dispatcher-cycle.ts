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
      if (task.retryAfter != null && new Date(task.retryAfter).getTime() > nowMs) continue

      result.tasksEvaluated++

      try {
        const agent = this.matchAgent(task)
        if (agent == null) {
          if (this.hasBusyEligibleAgent(task)) continue
          result.errors.push({ taskId: task.id, error: 'No available agent matches task' })
          continue
        }

        const options = this.resolveDispatchOptions(task)
        if (this.isWorktreeContested(task, options)) continue
        await this.dispatch(task, agent, options)
        result.tasksDispatched.push(task.id)
      } catch (error) {
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

  protected async runManagedCycle(): Promise<DispatchResult> {
    const result = await this.cycle()
    if (result.tasksDispatched.length > 0) {
      log.info('dispatcher', `dispatched ${result.tasksDispatched.length} task(s)`)
    }
    for (const dispatched of result.tasksDispatched) {
      this.lastLoggedErrors.delete(dispatched)
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

  protected matchAgent(task: Task): Agent | null {
    const busyAgentIds = new Set([...this.activeSessions.values()].map((entry) => entry.agentId))
    if (task.assignedAgentId != null) {
      if (busyAgentIds.has(task.assignedAgentId)) return null
      const agent = this.agentRepo.get(task.assignedAgentId)
      if (agent == null || this.shouldSkipUnhealthyAgent(agent)) return null
      return agent
    }

    const spec = this.specRepo.get(task.specId)
    if (spec == null) throw new Error(`Spec not found: ${task.specId}`)

    const targetRole = task.requiredRole ?? 'builder'
    const candidates: Agent[] = []
    for (const assignment of this.projectAgentRepo.getByRole(spec.projectId, targetRole)) {
      if (busyAgentIds.has(assignment.agentId)) continue
      const agent = this.agentRepo.get(assignment.agentId)
      if (agent != null && !this.shouldSkipUnhealthyAgent(agent)) candidates.push(agent)
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
   * Pick a same-role agent on a DIFFERENT provider (harness) than the failed
   * one, for recoverable-external failover (design/04 §5) — so an out-of-
   * credits/auth failure on one provider continues on another. Returns null
   * when no different-provider agent is free (caller freezes for the operator).
   */
  protected matchFailoverAgent(task: Task, failedAgent: Agent): Agent | null {
    const spec = this.specRepo.get(task.specId)
    if (spec == null) return null
    const busyAgentIds = new Set([...this.activeSessions.values()].map((entry) => entry.agentId))
    const targetRole = task.requiredRole ?? 'builder'
    const candidates: Agent[] = []
    for (const assignment of this.projectAgentRepo.getByRole(spec.projectId, targetRole)) {
      if (assignment.agentId === failedAgent.id || busyAgentIds.has(assignment.agentId)) continue
      const agent = this.agentRepo.get(assignment.agentId)
      if (agent == null || this.shouldSkipUnhealthyAgent(agent)) continue
      if (agent.harness === failedAgent.harness) continue
      candidates.push(agent)
    }
    candidates.sort((a, b) => a.costTier - b.costTier)
    return candidates[0] ?? null
  }

  protected hasBusyEligibleAgent(task: Task): boolean {
    const busyAgentIds = new Set([...this.activeSessions.values()].map((entry) => entry.agentId))
    if (task.assignedAgentId != null) {
      return busyAgentIds.has(task.assignedAgentId) && this.agentRepo.get(task.assignedAgentId) != null
    }
    const spec = this.specRepo.get(task.specId)
    if (spec == null) return false
    const targetRole = task.requiredRole ?? 'builder'
    return this.projectAgentRepo.getByRole(spec.projectId, targetRole).some((assignment) => {
      return busyAgentIds.has(assignment.agentId) && this.agentRepo.get(assignment.agentId) != null
    })
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
