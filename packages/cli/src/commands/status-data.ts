import {
  isActionableApprovalRun,
  type Agent,
  type Project,
  type Run,
  type Spec,
  type Task,
  type TaskDependency,
} from '@ductum/core'

import type { DuctumApi } from '../api-client.js'
import type { WorkspaceSnapshot } from '../types.js'
import { selectOpenWorkflowFollowup } from './status-followup.js'

const ACTIVE_EXCLUDED_STAGES = new Set(['done', 'failed', 'stalled', 'cancelled', 'awaiting_approval'])
const TERMINAL_DERIVED_STAGES = new Set(['done', 'failed', 'stalled', 'cancelled'])

export interface TaskRecord {
  task: Task
  spec: Spec
  project: Project
  agent: Agent | null
  dependencies: TaskDependency[]
}

export interface RunRecord {
  run: Run
  task: Task
  spec: Spec
  project: Project
  agent: Agent | null
  derivedStage: string
}

export type WorkflowFollowupRecord = TaskRecord

export interface RunFilters {
  active?: boolean
  stalled?: boolean
  done?: boolean
  waitingApproval?: boolean
}

export async function loadWorkspaceSnapshot(api: DuctumApi): Promise<WorkspaceSnapshot> {
  const [projects, agents] = await Promise.all([api.listProjects(), api.listAgents()])
  const [repositoryLists, projectAgentLists, specLists] = await Promise.all([
    Promise.all(projects.map((project) => api.listRepositories(project.id))),
    Promise.all(projects.map((project) => api.listProjectAgents(project.id))),
    Promise.all(projects.map((project) => api.listSpecs(project.id))),
  ])

  const specs = specLists.flat()
  const taskLists = await Promise.all(specs.map((spec) => api.listTasks(spec.id)))
  const tasks = taskLists.flat()
  const [dependencyLists, runLists] = await Promise.all([
    Promise.all(tasks.map((task) => api.listTaskDependencies(task.id))),
    Promise.all(tasks.map((task) => api.listTaskRuns(task.id))),
  ])

  return {
    projects,
    repositories: repositoryLists.flat(),
    projectAgents: projectAgentLists.flat(),
    agents,
    specs,
    tasks,
    taskDependencies: dependencyLists.flat(),
    runs: runLists.flat(),
  }
}

export function listTaskRecords(snapshot: WorkspaceSnapshot): TaskRecord[] {
  const projectById = new Map(snapshot.projects.map((project) => [project.id, project]))
  const specById = new Map(snapshot.specs.map((spec) => [spec.id, spec]))
  const agentById = new Map(snapshot.agents.map((agent) => [agent.id, agent]))
  const depsByTask = new Map(snapshot.tasks.map((task) => [task.id, [] as TaskDependency[]]))

  for (const dependency of snapshot.taskDependencies) {
    depsByTask.get(dependency.taskId)?.push(dependency)
  }

  return snapshot.tasks
    .map((task) => {
      const spec = specById.get(task.specId)
      const project = spec == null ? undefined : projectById.get(spec.projectId)
      if (spec == null || project == null) {
        return null
      }
      return {
        task,
        spec,
        project,
        agent: task.assignedAgentId == null ? null : (agentById.get(task.assignedAgentId) ?? null),
        dependencies: depsByTask.get(task.id) ?? [],
      }
    })
    .filter((record): record is TaskRecord => record != null)
    .sort(compareTaskRecords)
}

export function listRunRecords(snapshot: WorkspaceSnapshot, _now: Date): RunRecord[] {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const specById = new Map(snapshot.specs.map((spec) => [spec.id, spec]))
  const projectById = new Map(snapshot.projects.map((project) => [project.id, project]))
  const agentById = new Map(snapshot.agents.map((agent) => [agent.id, agent]))

  return snapshot.runs
    .map((run) => {
      const task = taskById.get(run.taskId)
      const spec = task == null ? undefined : specById.get(task.specId)
      const project = spec == null ? undefined : projectById.get(spec.projectId)
      if (task == null || spec == null || project == null) {
        return null
      }
      return {
        run,
        task,
        spec,
        project,
        agent: agentById.get(run.agentId) ?? null,
        derivedStage: deriveRunStage(run),
      }
    })
    .filter((record): record is RunRecord => record != null)
    .sort(compareRunRecords)
}

export function deriveRunStage(run: Run) {
  if (run.terminalState === 'stalled') {
    return 'stalled'
  }
  if (run.terminalState === 'failed') {
    return 'failed'
  }
  if (run.terminalState === 'cancelled') {
    return 'cancelled'
  }
  if (run.stage === 'done') {
    return 'done'
  }
  if (run.pendingApproval && run.stage === 'ship') {
    return 'awaiting_approval'
  }
  return run.stage
}

export function findRunRecord(snapshot: WorkspaceSnapshot, runId: string, now: Date) {
  return listRunRecords(snapshot, now).find((record) => record.run.id === runId) ?? null
}

export function listReadyTasks(snapshot: WorkspaceSnapshot) {
  return listTaskRecords(snapshot).filter((record) => record.task.status === 'ready')
}

export function listWaitingApprovalRuns(snapshot: WorkspaceSnapshot, now: Date) {
  return listRunRecords(snapshot, now).filter((record) =>
    record.derivedStage === 'awaiting_approval'
    && isActionableApprovalRun(record.run, snapshot.runs),
  )
}

export function listActiveRuns(snapshot: WorkspaceSnapshot, now: Date) {
  return leafRunRecords(listRunRecords(snapshot, now)).filter((record) =>
    !ACTIVE_EXCLUDED_STAGES.has(record.derivedStage)
    && findOpenWorkflowFollowup(snapshot, record.run) == null,
  )
}

export function listStalledRuns(snapshot: WorkspaceSnapshot, now: Date) {
  return listRunRecords(snapshot, now).filter((record) => record.derivedStage === 'stalled')
}

export function listNeedsOperatorRuns(snapshot: WorkspaceSnapshot, now: Date) {
  const records = listRunRecords(snapshot, now)
  const latestRecords = latestRunRecordByTask(records)
  const liveTaskIds = new Set(
    records
      .filter((record) => !ACTIVE_EXCLUDED_STAGES.has(record.derivedStage))
      .map((record) => record.task.id),
  )
  return latestRecords.filter((record) =>
    record.task.status === 'active'
    && ['failed', 'stalled'].includes(record.derivedStage)
    && !liveTaskIds.has(record.task.id),
  )
}

export function findOpenWorkflowFollowup(
  snapshot: WorkspaceSnapshot,
  run: Pick<Run, 'taskId'>,
): WorkflowFollowupRecord | null {
  return selectOpenWorkflowFollowup(listTaskRecords(snapshot), run)
}

export function filterRuns(
  records: RunRecord[],
  filters: RunFilters,
) {
  const modes = new Set<string>()
  if (filters.active) modes.add('active')
  if (filters.stalled) modes.add('stalled')
  if (filters.done) modes.add('done')
  if (filters.waitingApproval) modes.add('waiting_approval')
  if (modes.size === 0) {
    return records
  }
  const activeLeafIds = new Set(leafRunRecords(records).map((record) => record.run.id))
  return records.filter((record) => {
    if (modes.has('active') && !ACTIVE_EXCLUDED_STAGES.has(record.derivedStage)) {
      return activeLeafIds.has(record.run.id)
    }
    if (modes.has('stalled') && record.derivedStage === 'stalled') {
      return true
    }
    if (modes.has('done') && record.derivedStage === 'done') {
      return true
    }
    if (modes.has('waiting_approval') && record.derivedStage === 'awaiting_approval') {
      return true
    }
    return false
  })
}

function leafRunRecords(records: RunRecord[]): RunRecord[] {
  const childrenByParent = new Map<string, RunRecord[]>()
  for (const record of records) {
    if (record.run.parentRunId == null) continue
    const children = childrenByParent.get(record.run.parentRunId) ?? []
    children.push(record)
    childrenByParent.set(record.run.parentRunId, children)
  }

  const hasOpenDescendant = (record: RunRecord) => {
    const stack = [...(childrenByParent.get(record.run.id) ?? [])]
    while (stack.length > 0) {
      const child = stack.pop()!
      if (!TERMINAL_DERIVED_STAGES.has(child.derivedStage)) return true
      stack.push(...(childrenByParent.get(child.run.id) ?? []))
    }
    return false
  }

  return records.filter((record) => !hasOpenDescendant(record))
}

function latestRunRecordByTask(records: RunRecord[]): RunRecord[] {
  const latest = new Map<string, RunRecord>()
  for (const record of records) {
    const current = latest.get(record.task.id)
    if (current == null || compareRunRecency(current.run, record.run) < 0) {
      latest.set(record.task.id, record)
    }
  }
  return records.filter((record) => latest.get(record.task.id)?.run.id === record.run.id)
}

function compareRunRecency(left: Run, right: Run) {
  return (
    compareText(left.createdAt, right.createdAt) ||
    compareText(left.updatedAt, right.updatedAt) ||
    compareText(left.id, right.id)
  )
}

function compareTaskRecords(left: TaskRecord, right: TaskRecord) {
  return (
    compareText(left.project.name, right.project.name) ||
    compareText(left.spec.name, right.spec.name) ||
    compareText(left.task.name, right.task.name) ||
    compareText(left.task.id, right.task.id)
  )
}

function compareRunRecords(left: RunRecord, right: RunRecord) {
  return (
    compareText(left.project.name, right.project.name) ||
    compareText(left.spec.name, right.spec.name) ||
    compareText(left.task.name, right.task.name) ||
    compareText(left.run.updatedAt, right.run.updatedAt) ||
    compareText(left.run.id, right.run.id)
  )
}

function compareText(left: string, right: string) {
  return left.localeCompare(right)
}
