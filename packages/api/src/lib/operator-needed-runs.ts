import {
  deriveDisplayStatus,
  whatToDoNext,
  type Agent,
  type Project,
  type Run,
  type Spec,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'

const ACTIVE_EXCLUDED_STAGES = new Set([
  'done', 'failed', 'stalled', 'cancelled', 'awaiting_approval',
  'paused', 'frozen', 'quarantined',
])

export interface NeedsOperatorRunRecord {
  run: Run
  task: Task
  spec: Spec
  project: Project
  agent: Agent | null
  derivedStage: string
}

export function listNeedsOperatorRunRecords(
  context: ApiContext,
  now: Date,
  options: { limit?: number } = {},
): NeedsOperatorRunRecord[] {
  const records = listRunRecords(context)
  const latestRecords = latestRunRecordByTask(records)
  const liveTaskIds = new Set(
    records
      .filter((record) => !ACTIVE_EXCLUDED_STAGES.has(record.derivedStage))
      .map((record) => record.task.id),
  )

  const matches = latestRecords.filter((record) => {
    if (!isNeedsOperatorTaskStatus(record.task) || liveTaskIds.has(record.task.id)) return false
    const next = whatToDoNext(record.run, record.task, { now })
    return next.needsOperator && next.kind !== 'waiting-on-approval'
  })
  return options.limit == null ? matches : matches.slice(0, Math.max(0, options.limit))
}

export function countNeedsOperatorRuns(context: ApiContext, now: Date): number {
  return listNeedsOperatorRunRecords(context, now).length
}

export function listNeedsOperatorRuns(context: ApiContext, now: Date, options: { limit?: number } = {}): Run[] {
  return listNeedsOperatorRunRecords(context, now, options).map((record) => record.run)
}

function listRunRecords(context: ApiContext): NeedsOperatorRunRecord[] {
  return context.repos.runs.listAll({ limit: null })
    .map((run) => toRunRecord(context, run))
    .filter((record): record is NeedsOperatorRunRecord => record != null)
    .sort(compareRunRecords)
}

function toRunRecord(context: ApiContext, run: Run): NeedsOperatorRunRecord | null {
  const task = context.repos.tasks.get(run.taskId)
  const spec = task == null ? null : context.repos.specs.get(task.specId)
  const project = spec == null ? null : context.repos.projects.get(spec.projectId)
  if (task == null || spec == null || project == null) return null
  return {
    run,
    task,
    spec,
    project,
    agent: context.repos.agents.get(run.agentId),
    derivedStage: deriveRunStage(run),
  }
}

function deriveRunStage(run: Run): string {
  const status = deriveDisplayStatus(run)
  return status === 'running' ? run.stage : status
}

function latestRunRecordByTask(records: NeedsOperatorRunRecord[]): NeedsOperatorRunRecord[] {
  const latest = new Map<string, NeedsOperatorRunRecord>()
  for (const record of records) {
    const current = latest.get(record.task.id)
    if (current == null || compareRunRecency(current.run, record.run) < 0) {
      latest.set(record.task.id, record)
    }
  }
  return records.filter((record) => latest.get(record.task.id)?.run.id === record.run.id)
}

function isNeedsOperatorTaskStatus(task: Task): boolean {
  return task.status === 'active' || task.status === 'failed'
}

function compareRunRecords(left: NeedsOperatorRunRecord, right: NeedsOperatorRunRecord): number {
  return (
    compareText(left.project.name, right.project.name)
    || compareText(left.spec.name, right.spec.name)
    || compareText(left.task.name, right.task.name)
    || compareRunRecency(left.run, right.run)
  )
}

function compareRunRecency(left: Run, right: Run): number {
  return (
    compareText(left.createdAt, right.createdAt)
    || compareText(left.updatedAt, right.updatedAt)
    || compareText(left.id, right.id)
  )
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right)
}
