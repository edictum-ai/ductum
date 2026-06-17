import {
  evaluateRunExecutionIntegrity,
  evaluateTaskExecutionIntegrity,
  type Evidence,
  type ExecutionIntegrity,
  type ExecutionIssue,
  type ExecutionMode,
  type Run,
  type Spec,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { buildExecutionIntegritySummary } from './execution-integrity-summary.js'

export interface ExecutionIntegrityFields {
  executionMode: ExecutionMode
  executionIssues: ExecutionIssue[]
  hasDuctumLineage: boolean
  hasExternalOutcome: boolean
  externalOutcome: string | null
  bakeoffOutcome: string | null
}

export interface ExecutionIntegrityReport {
  generatedAt: string
  summary: ExecutionIntegritySummary
  tasks: ExecutionIntegrityTaskEntry[]
  runs: ExecutionIntegrityRunEntry[]
}

export interface ExecutionIntegritySummary {
  taskCount: number
  runCount: number
  issueCount: number
  taskIssueCount: number
  runIssueCount: number
  taskModes: Record<ExecutionMode, number>
  runModes: Record<ExecutionMode, number>
  issues: ExecutionIntegrityIssueSample[]
  issuesTruncated: boolean
}

export interface ExecutionIntegrityIssueSample {
  scope: 'task' | 'run'
  id: string
  projectName: string
  specName: string
  taskName: string
  runId: string | null
  executionMode: ExecutionMode
  issueCode: string
  issueMessage: string
  status: string
}

export interface ExecutionIntegrityTaskEntry extends ExecutionIntegrityFields {
  taskId: string
  taskName: string
  taskStatus: string
  specId: string
  specName: string
  projectName: string
  runIds: string[]
}

export interface ExecutionIntegrityRunEntry extends ExecutionIntegrityFields {
  runId: string
  taskId: string
  taskName: string
  specName: string
  projectName: string
  stage: string
  terminalState: string | null
  sessionId: string | null
  commitSha: string | null
  worktreePaths: string[] | null
}

export function buildExecutionIntegrityReport(context: ApiContext): ExecutionIntegrityReport {
  const entries = collectExecutionIntegrity(context)
  return {
    generatedAt: context.now().toISOString(),
    summary: buildExecutionIntegritySummary(entries),
    tasks: entries.tasks,
    runs: entries.runs,
  }
}

export function getRunExecutionIntegrityFields(context: ApiContext, run: Run): ExecutionIntegrityFields {
  return getRunExecutionIntegrityFieldsMap(context, [run]).get(run.id)!
}

export function getTaskExecutionIntegrityFields(
  context: ApiContext,
  task: Task,
  spec: Spec | null = context.repos.specs.get(task.specId),
): ExecutionIntegrityFields {
  return getTaskExecutionIntegrityFieldsMap(context, [task], new Map([[task.specId, spec]])).get(task.id)!
}

export function getRunExecutionIntegrityFieldsMap(
  context: ApiContext,
  runs: readonly Run[],
): Map<Run['id'], ExecutionIntegrityFields> {
  return buildRunIntegrityFieldsMap(runs, listEvidenceByRunId(context, runs.map((run) => run.id)))
}

export function getTaskExecutionIntegrityFieldsMap(
  context: ApiContext,
  tasks: readonly Task[],
  specById = new Map(tasks.map((task) => [task.specId, context.repos.specs.get(task.specId)] as const)),
): Map<Task['id'], ExecutionIntegrityFields> {
  const runs = context.repos.runs.listByTaskIds(tasks.map((task) => task.id))
  const evidenceByRunId = listEvidenceByRunId(context, runs.map((run) => run.id))
  return buildTaskIntegrityFieldsMap(tasks, specById, groupRunsByTaskId(runs), evidenceByRunId)
}

function collectExecutionIntegrity(context: ApiContext): {
  tasks: ExecutionIntegrityTaskEntry[]
  runs: ExecutionIntegrityRunEntry[]
} {
  const factory = context.repos.factory.get()
  if (factory == null) return { tasks: [], runs: [] }

  const projects = context.repos.projects.list(factory.id)
  const projectById = new Map(projects.map((project) => [project.id, project] as const))
  const specs = projects.flatMap((project) => context.repos.specs.list(project.id))
  const specById = new Map(specs.map((spec) => [spec.id, spec] as const))
  const tasks = context.repos.tasks.listBySpecIds(specs.map((spec) => spec.id))
  const taskById = new Map(tasks.map((task) => [task.id, task] as const))
  const runs = context.repos.runs.listByTaskIds(tasks.map((task) => task.id))
  const runsByTaskId = groupRunsByTaskId(runs)
  const evidenceByRunId = listEvidenceByRunId(context, runs.map((run) => run.id))
  const runFieldsById = buildRunIntegrityFieldsMap(runs, evidenceByRunId)
  const taskFieldsById = buildTaskIntegrityFieldsMap(tasks, specById, runsByTaskId, evidenceByRunId)

  return {
    tasks: tasks.map((task) => {
      const spec = specById.get(task.specId)!
      const project = projectById.get(spec.projectId)!
      const taskRuns = runsByTaskId.get(task.id) ?? []
      return {
        ...taskFieldsById.get(task.id)!,
        taskId: task.id,
        taskName: task.name,
        taskStatus: task.status,
        specId: spec.id,
        specName: spec.name,
        projectName: project.name,
        runIds: taskRuns.map((run) => run.id),
      }
    }),
    runs: runs.map((run) => {
      const task = taskById.get(run.taskId)!
      const spec = specById.get(task.specId)!
      const project = projectById.get(spec.projectId)!
      return {
        ...runFieldsById.get(run.id)!,
        runId: run.id,
        taskId: task.id,
        taskName: task.name,
        specName: spec.name,
        projectName: project.name,
        stage: run.stage,
        terminalState: run.terminalState,
        sessionId: run.sessionId,
        commitSha: run.commitSha,
        worktreePaths: run.worktreePaths,
      }
    }),
  }
}

function toFields(integrity: ExecutionIntegrity): ExecutionIntegrityFields {
  return {
    executionMode: integrity.mode,
    executionIssues: integrity.issues,
    hasDuctumLineage: integrity.hasDuctumLineage,
    hasExternalOutcome: integrity.hasExternalOutcome,
    externalOutcome: integrity.externalOutcome,
    bakeoffOutcome: integrity.bakeoffOutcome,
  }
}

function buildRunIntegrityFieldsMap(
  runs: readonly Run[],
  evidenceByRunId: ReadonlyMap<Run['id'], readonly Evidence[]>,
): Map<Run['id'], ExecutionIntegrityFields> {
  return new Map(
    runs.map((run) => [run.id, toFields(evaluateRunExecutionIntegrity(run, evidenceByRunId.get(run.id) ?? []))] as const),
  )
}

function buildTaskIntegrityFieldsMap(
  tasks: readonly Task[],
  specById: ReadonlyMap<Spec['id'], Pick<Spec, 'strategy'> | null | undefined>,
  runsByTaskId: ReadonlyMap<Task['id'], readonly Run[]>,
  evidenceByRunId: ReadonlyMap<Run['id'], readonly Evidence[]>,
): Map<Task['id'], ExecutionIntegrityFields> {
  return new Map(
    tasks.map((task) => [
      task.id,
      toFields(evaluateTaskExecutionIntegrity(task, specById.get(task.specId), runsByTaskId.get(task.id) ?? [], evidenceByRunId)),
    ] as const),
  )
}

function groupRunsByTaskId(runs: readonly Run[]): Map<Task['id'], Run[]> {
  const runsByTaskId = new Map<Task['id'], Run[]>()
  for (const run of runs) {
    const taskRuns = runsByTaskId.get(run.taskId) ?? []
    taskRuns.push(run)
    runsByTaskId.set(run.taskId, taskRuns)
  }
  return runsByTaskId
}

function listEvidenceByRunId(
  context: ApiContext,
  runIds: readonly Run['id'][],
): Map<Run['id'], Evidence[]> {
  const evidenceByRunId = new Map<Run['id'], Evidence[]>()
  for (const evidence of context.repos.evidence.listByRunIds(runIds)) {
    const items = evidenceByRunId.get(evidence.runId) ?? []
    items.push(evidence)
    evidenceByRunId.set(evidence.runId, items)
  }
  return evidenceByRunId
}
