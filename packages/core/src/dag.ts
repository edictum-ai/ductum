import { DuctumEventEmitter } from './events.js'
import { isBakeoffBlindReviewTask } from './bakeoff.js'
import { findTaskCycle } from './dag-cycle.js'
import type { RunRepo, SpecDependencyRepo, SpecRepo, TaskDependencyRepo, TaskRepo } from './repos/interfaces.js'
import type { AgentRole, ProjectId, Run, RunId, SpecId, SpecStatus, Task, TaskId, TaskStatus } from './types.js'

const RESOLVABLE_TASK_STATUSES = new Set<TaskStatus>(['pending', 'blocked'])
function isTerminalRun(run: Run): boolean {
  return run.stage === 'done' || run.terminalState != null
}

export interface DAGValidationResult {
  valid: boolean
  cycle?: TaskId[]
}

export class DAGEvaluator {
  constructor(
    private readonly taskRepo: TaskRepo,
    private readonly taskDepRepo: TaskDependencyRepo,
    private readonly specRepo: SpecRepo,
    private readonly specDepRepo: SpecDependencyRepo,
    private readonly runRepo: RunRepo,
    private readonly eventEmitter: DuctumEventEmitter,
  ) {}

  evaluateTaskDAG(specId: SpecId): TaskId[] {
    const tasks = this.taskRepo.list(specId)
    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const dependencies = this.listTaskDependencies(tasks)
    const newlyReady: TaskId[] = []

    let changed = true
    while (changed) {
      changed = false

      for (const task of tasks) {
        const current = taskById.get(task.id)
        if (current == null || !this.canResolveTaskStatus(current, taskById, dependencies)) {
          continue
        }

        const nextStatus = this.resolveTaskStatus(current, taskById, dependencies)
        if (nextStatus === current.status) continue

        const updated = this.updateTaskStatus(current, nextStatus)
        taskById.set(updated.id, updated)
        changed = true
        if (nextStatus === 'ready') newlyReady.push(updated.id)
      }
    }

    this.reconcileSpecStatus(specId)
    return newlyReady
  }

  evaluateSpecDAG(projectId: ProjectId): SpecId[] {
    const specs = this.specRepo.list(projectId)
    const specById = new Map(specs.map((spec) => [spec.id, spec]))
    const ready: SpecId[] = []

    for (const spec of specs) {
      if (spec.status !== 'approved') {
        continue
      }

      const blockingDeps = this.specDepRepo
        .list(spec.id)
        .filter((dep) => dep.kind === 'hard')

      if (blockingDeps.every((dep) => specById.get(dep.dependsOnId)?.status === 'done')) {
        ready.push(spec.id)
      }
    }

    return ready
  }

  onRunComplete(runId: RunId): void {
    const run = this.requireRun(runId)
    const task = this.requireTask(run.taskId)
    const latestRun = this.getLatestRun(task.id)

    if (latestRun != null && isTerminalRun(latestRun)) {
      const nextTaskStatus = latestRun.stage === 'done' && latestRun.terminalState == null ? 'done' : 'failed'
      if (task.status !== nextTaskStatus) {
        this.updateTaskStatus(task, nextTaskStatus)
      }
    }

    this.evaluateTaskDAG(task.specId)

    const spec = this.requireSpec(task.specId)
    this.reconcileSpecStatus(spec.id)
    this.evaluateSpecDAG(spec.projectId)
  }

  nextTask(projectId?: ProjectId, role?: AgentRole): Task | null {
    return this.taskRepo.getReady(projectId, role)[0] ?? null
  }

  validateDAG(specId: SpecId): DAGValidationResult {
    const tasks = this.taskRepo.list(specId)
    const taskIds = tasks.map((task) => task.id)
    const dependencyMap = this.listTaskDependencies(tasks)
    const outgoing = new Map<TaskId, TaskId[]>()
    const indegree = new Map(taskIds.map((taskId) => [taskId, 0]))

    for (const taskId of taskIds) {
      outgoing.set(taskId, [])
    }

    for (const [taskId, dependsOnIds] of dependencyMap.entries()) {
      indegree.set(taskId, dependsOnIds.length)
      for (const dependsOnId of dependsOnIds) {
        outgoing.get(dependsOnId)?.push(taskId)
      }
    }

    const queue = taskIds.filter((taskId) => indegree.get(taskId) === 0)
    const visited: TaskId[] = []

    while (queue.length > 0) {
      const taskId = queue.shift()
      if (taskId == null) {
        continue
      }

      visited.push(taskId)
      for (const dependentId of outgoing.get(taskId) ?? []) {
        const nextIndegree = (indegree.get(dependentId) ?? 0) - 1
        indegree.set(dependentId, nextIndegree)
        if (nextIndegree === 0) {
          queue.push(dependentId)
        }
      }
    }

    if (visited.length === taskIds.length) {
      return { valid: true }
    }

    const remaining = new Set(taskIds.filter((taskId) => (indegree.get(taskId) ?? 0) > 0))
    return { valid: false, cycle: findTaskCycle(dependencyMap, remaining) }
  }

  private listTaskDependencies(tasks: Task[]): Map<TaskId, TaskId[]> {
    return new Map(
      tasks.map((task) => [
        task.id,
        this.taskDepRepo.list(task.id).map((dep) => dep.dependsOnId),
      ]),
    )
  }

  private resolveTaskStatus(
    task: Task,
    taskById: Map<TaskId, Task>,
    dependencies: Map<TaskId, TaskId[]>,
  ): TaskStatus {
    const dependencyStatuses = (dependencies.get(task.id) ?? [])
      .map((taskId) => taskById.get(taskId)?.status)

    if (task.status === 'blocked' && dependencyStatuses.length === 0) {
      return 'blocked'
    }

    if (isBakeoffBlindReviewTask(this.specRepo.get(task.specId), task) && dependencyStatuses.length > 0) {
      return dependencyStatuses.every((status) => status === 'done' || status === 'failed')
        ? 'ready'
        : 'blocked'
    }

    if (dependencyStatuses.some((status) => status === 'failed')) {
      return 'failed'
    }
    if (dependencyStatuses.every((status) => status === 'done')) {
      return 'ready'
    }
    return 'blocked'
  }

  private canResolveTaskStatus(
    task: Task,
    taskById: Map<TaskId, Task>,
    dependencies: Map<TaskId, TaskId[]>,
  ): boolean {
    if (RESOLVABLE_TASK_STATUSES.has(task.status)) return true
    if (task.status !== 'failed' || this.runRepo.list(task.id).length > 0) return false
    const dependencyIds = dependencies.get(task.id) ?? []
    if (dependencyIds.length === 0) return false
    return dependencyIds.every((taskId) => taskById.get(taskId)?.status !== 'failed')
  }

  private reconcileSpecStatus(specId: SpecId): void {
    const spec = this.requireSpec(specId)
    const tasks = this.taskRepo.list(spec.id)
    if (tasks.length === 0) return
    const allDone = tasks.every((task) => task.status === 'done')
    const anyFailed = tasks.some((task) => task.status === 'failed')
    if (allDone) return this.updateSpecStatus(spec.id, 'done')
    if (anyFailed && tasks.every((task) => task.status === 'done' || task.status === 'failed')) {
      return this.updateSpecStatus(spec.id, 'failed')
    }
    if (spec.status === 'approved' && tasks.some((task) => ['active', 'done', 'failed'].includes(task.status))) this.updateSpecStatus(spec.id, 'implementing')
    // Issue #243: failed/draft parent spec with queued retry work AND
    // existing run history returns to implementing. Ordinary draft specs
    // without run history must NOT be promoted.
    if ((spec.status === 'failed' || spec.status === 'draft')
      && tasks.some((t) => t.status === 'ready' || t.status === 'active')
      && tasks.some((t) => this.runRepo.list(t.id).length > 0)) {
      this.updateSpecStatus(spec.id, 'implementing')
    }
  }

  private updateTaskStatus(task: Task, nextStatus: TaskStatus): Task {
    const updated = this.taskRepo.updateStatus(task.id, nextStatus)
    this.eventEmitter.emit({
      type: 'task.status_changed',
      taskId: task.id,
      from: task.status,
      to: nextStatus,
    })
    return updated
  }

  private updateSpecStatus(specId: SpecId, nextStatus: SpecStatus): void {
    const current = this.requireSpec(specId)
    if (current.status === nextStatus) {
      return
    }

    this.specRepo.updateStatus(specId, nextStatus)
    this.eventEmitter.emit({
      type: 'spec.status_changed',
      specId,
      from: current.status,
      to: nextStatus,
    })
  }

  private getLatestRun(taskId: TaskId): Run | null {
    const runs = this.runRepo.list(taskId)
    return runs.at(-1) ?? null
  }

  private requireRun(runId: RunId): Run {
    const run = this.runRepo.get(runId)
    if (run == null) throw new Error(`Run not found: ${runId}`)
    return run
  }

  private requireTask(taskId: TaskId): Task {
    const task = this.taskRepo.get(taskId)
    if (task == null) throw new Error(`Task not found: ${taskId}`)
    return task
  }

  private requireSpec(specId: SpecId) {
    const spec = this.specRepo.get(specId)
    if (spec == null) throw new Error(`Spec not found: ${specId}`)
    return spec
  }
}
