import type { ExecutionIntegrityReport, ExecutionMode, OperatorBrief } from '@/api/client'

export const EXECUTION_MODE_ORDER = [
  'orchestrated',
  'external',
  'recorded',
  'unknown',
  'inconsistent',
] as const satisfies readonly ExecutionMode[]

const TASK_STATUS_ORDER = ['pending', 'ready', 'blocked', 'active', 'done', 'failed'] as const

type TaskStatusKey = (typeof TASK_STATUS_ORDER)[number]

export interface TaskStatusCounts {
  pending: number
  ready: number
  blocked: number
  active: number
  done: number
  failed: number
}

export interface OperatorProgressSnapshot {
  taskTotal: number
  runTotal: number
  taskCounts: TaskStatusCounts
  activeRuns: number
  approvalsWaiting: number
  readyTasks: number
  needsOperator: number
  integrityIssues: number
  readiness: 'clear' | 'attention'
  taskModes: Record<ExecutionMode, number>
  runModes: Record<ExecutionMode, number>
  issueSamples: NonNullable<OperatorBrief['integrity']>['issues']
  issuesTruncated: boolean
  externalCount: number
  recordedCount: number
}

export function buildOperatorProgressSnapshot(
  brief?: OperatorBrief,
  report?: ExecutionIntegrityReport,
): OperatorProgressSnapshot {
  const taskCounts = countTaskStatuses(report)
  const taskModes = normalizeModeCounts(brief?.integrity?.taskModes ?? report?.summary.taskModes)
  const runModes = normalizeModeCounts(brief?.integrity?.runModes ?? report?.summary.runModes)
  const externalCount = (taskModes.external ?? 0) + (runModes.external ?? 0)
  const recordedCount = (taskModes.recorded ?? 0) + (runModes.recorded ?? 0)

  return {
    taskTotal: report?.summary.taskCount ?? sumTaskCounts(taskCounts),
    runTotal: report?.summary.runCount ?? 0,
    taskCounts,
    activeRuns: brief?.queue.activeRuns ?? 0,
    approvalsWaiting: brief?.queue.approvalsWaiting ?? 0,
    readyTasks: brief?.queue.readyTasks ?? taskCounts.ready,
    needsOperator: brief?.queue.needsOperator ?? 0,
    integrityIssues: brief?.queue.integrityIssues ?? report?.summary.issueCount ?? 0,
    readiness: brief?.integrity?.readiness ?? ((report?.summary.issueCount ?? 0) > 0 ? 'attention' : 'clear'),
    taskModes,
    runModes,
    issueSamples: brief?.integrity?.issues ?? report?.summary.issues ?? [],
    issuesTruncated: brief?.integrity?.issuesTruncated ?? report?.summary.issuesTruncated ?? false,
    externalCount,
    recordedCount,
  }
}

export function buildProgressHeadline(snapshot: OperatorProgressSnapshot): string {
  if (snapshot.activeRuns === 0 && snapshot.approvalsWaiting === 0) {
    if (snapshot.readyTasks > 0) {
      return `No active work right now. ${snapshot.readyTasks} ready task${plural(snapshot.readyTasks)} waiting to dispatch.`
    }
    if (snapshot.needsOperator > 0) {
      return `No active work right now. ${snapshot.needsOperator} blocked/failed attempt${plural(snapshot.needsOperator)} need operator action.`
    }
    return 'No active work right now.'
  }

  const parts = [`${snapshot.taskCounts.done} of ${snapshot.taskTotal} tasks done`]
  if (snapshot.activeRuns > 0) parts.push(`${snapshot.activeRuns} active attempt${plural(snapshot.activeRuns)}`)
  if (snapshot.approvalsWaiting > 0) parts.push(`${snapshot.approvalsWaiting} awaiting approval`)
  if (snapshot.needsOperator > 0) parts.push(`${snapshot.needsOperator} blocked/failed attempt${plural(snapshot.needsOperator)}`)
  if (snapshot.integrityIssues > 0) parts.push(`${snapshot.integrityIssues} integrity issue${plural(snapshot.integrityIssues)}`)
  return parts.join(' · ')
}

function countTaskStatuses(report?: ExecutionIntegrityReport): TaskStatusCounts {
  const counts: TaskStatusCounts = {
    pending: 0,
    ready: 0,
    blocked: 0,
    active: 0,
    done: 0,
    failed: 0,
  }

  for (const task of report?.tasks ?? []) {
    const key = normalizeTaskStatus(task.taskStatus)
    if (key != null) counts[key] += 1
  }

  return counts
}

function normalizeTaskStatus(status: string | null | undefined): TaskStatusKey | null {
  if (status == null) return null
  const key = status.toLowerCase()
  if ((TASK_STATUS_ORDER as readonly string[]).includes(key)) return key as TaskStatusKey
  if (key === 'in-progress') return 'active'
  return null
}

function normalizeModeCounts(
  counts?: Partial<Record<ExecutionMode, number>>,
): Record<ExecutionMode, number> {
  return {
    orchestrated: counts?.orchestrated ?? 0,
    external: counts?.external ?? 0,
    recorded: counts?.recorded ?? 0,
    unknown: counts?.unknown ?? 0,
    inconsistent: counts?.inconsistent ?? 0,
  }
}

function sumTaskCounts(counts: TaskStatusCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
