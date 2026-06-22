import { formatTable } from '../format.js'
import { renderSections, titleLabel } from './common.js'
import { buildLogsCommand, buildRetryCommand, buildStatusCommand, buildWatchCommand, withDuctum } from './attempt-actions.js'
import { buildSharedNextAction, type OperatorNextAction } from './next-action.js'
import {
  listActiveRuns,
  listNeedsOperatorRuns,
  listReadyTasks,
  listStalledRuns,
  listWaitingApprovalRuns,
} from './status-data.js'
import type { RunRecord } from './status-data.js'
import type { WorkspaceSnapshot } from '../types.js'

export { titleLabel } from './common.js'

interface ProjectSummaryRow {
  project: string
  repositories: number
  specs: number
  tasks: number
  ready: number
  attempts: number
  attention: number
}

interface StatusOverviewPayload {
  projects: ProjectSummaryRow[]
  factoryActivity: {
    activeAttempts: number
    readyTasks: number
    stalledAttempts: number
    approvalsWaiting: number
    repairNeeded: number
    agents: number
    projectAssignments: number
  }
  setup: {
    state: 'ready' | 'setup_incomplete'
    message: string
  }
  needsOperator: RecoveryAttemptRow[]
  nextActions: string[]
}

interface RecoveryAttemptRow {
  project: string
  spec: string
  task: string
  attempt: string
  status: string
  reason: string
  nextCommand: string
}

export function buildStatusOverview(snapshot: WorkspaceSnapshot, now: Date): StatusOverviewPayload {
  const activeAttempts = listActiveRuns(snapshot, now)
  const stalledAttempts = listStalledRuns(snapshot, now)
  const approvalsWaiting = listWaitingApprovalRuns(snapshot, now)
  const repairNeeded = listNeedsOperatorRuns(snapshot, now)
  const nextAction = buildSharedNextAction({ snapshot, now })
  const setup = setupState(nextAction)
  return {
    projects: projectRows(snapshot, now),
    factoryActivity: {
      activeAttempts: activeAttempts.length,
      readyTasks: listReadyTasks(snapshot).length,
      stalledAttempts: stalledAttempts.length,
      approvalsWaiting: approvalsWaiting.length,
      repairNeeded: repairNeeded.length,
      agents: snapshot.agents.length,
      projectAssignments: snapshot.projectAgents.length,
    },
    setup,
    needsOperator: recoveryRows(repairNeeded),
    nextActions: renderNextActions(nextAction),
  }
}

export function renderStatusOverview(payload: StatusOverviewPayload): string {
  return renderSections(
    `Projects\n${formatTable(projectColumns(), payload.projects)}`,
    `Factory Activity\n${formatTable(activityColumns(), [payload.factoryActivity])}`,
    payload.setup.state === 'ready'
      ? ''
      : ['Setup / Migration', payload.setup.message].join('\n'),
    payload.needsOperator.length === 0
      ? ''
      : `Needs Attention\n${formatTable(recoveryColumns(), payload.needsOperator)}`,
    ['Next Operator Actions', payload.nextActions.map((item, index) => `${index + 1}. ${item}`).join('\n')].join('\n'),
  )
}

export function formatAttemptPhase(value: string | null | undefined): string {
  switch (value) {
    case 'understand':
      return 'Understanding'
    case 'implement':
      return 'In progress'
    case 'review':
      return 'Reviewing'
    case 'verify':
      return 'Verifying'
    case 'ship':
      return 'Awaiting approval'
    case 'awaiting_approval':
      return 'Awaiting approval'
    case 'awaiting_review':
      return 'Awaiting review'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'stalled':
      return 'Stalled'
    case 'cancelled':
      return 'Cancelled'
    default:
      return titleLabel(value ?? 'unknown')
  }
}

function projectRows(snapshot: WorkspaceSnapshot, now: Date): ProjectSummaryRow[] {
  const repositoriesByProject = countBy(snapshot.repositories, (repository) => repository.projectId)
  const specsByProject = countBy(snapshot.specs, (spec) => spec.projectId)
  const tasksByProject = taskProjectCounts(snapshot)
  const activeByProject = countBy(listActiveRuns(snapshot, now), (record) => record.project.id)
  const attentionByProject = countBy(listNeedsOperatorRuns(snapshot, now), (record) => record.project.id)
  return snapshot.projects.map((project) => ({
    project: project.name,
    repositories: repositoriesByProject.get(project.id) ?? 0,
    specs: specsByProject.get(project.id) ?? 0,
    tasks: tasksByProject.get(project.id) ?? 0,
    ready: listReadyTasks(snapshot).filter((record) => record.project.id === project.id).length,
    attempts: activeByProject.get(project.id) ?? 0,
    attention: attentionByProject.get(project.id) ?? 0,
  }))
}

function taskProjectCounts(snapshot: WorkspaceSnapshot): Map<string, number> {
  const specProject = new Map(snapshot.specs.map((spec) => [spec.id, spec.projectId]))
  const counts = new Map<string, number>()
  for (const task of snapshot.tasks) {
    const projectId = specProject.get(task.specId)
    if (projectId == null) continue
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1)
  }
  return counts
}

function setupState(nextAction: OperatorNextAction): StatusOverviewPayload['setup'] {
  const incomplete = new Set(['initialize_factory', 'create_project', 'add_repository', 'repair_agent_setup', 'repair_project_assignment'])
  if (incomplete.has(nextAction.state)) {
    return { state: 'setup_incomplete', message: `${nextAction.reason} Next: ${nextAction.commands.join(' then ')}` }
  }
  return { state: 'ready', message: 'Project setup is ready.' }
}

function renderNextActions(nextAction: OperatorNextAction): string[] {
  return [
    `${nextAction.reason} Next: ${nextAction.commands.join(' then ')}`,
    ...(nextAction.alternateCommands == null || nextAction.alternateCommands.length === 0
      ? []
      : [`Alternate: ${nextAction.alternateCommands.join(' or ')}`]),
  ]
}

function recoveryRows(records: RunRecord[]): RecoveryAttemptRow[] {
  return records.map((record) => ({
    project: record.project.name,
    spec: record.spec.name,
    task: record.task.name,
    attempt: record.run.id,
    status: formatAttemptPhase(record.derivedStage),
    reason: compactReason(recoveryReason(record)),
    nextCommand: [
      withDuctum(buildStatusCommand(record.run.id)),
      withDuctum(buildLogsCommand(record.run.id)),
      withDuctum(buildWatchCommand(record.run.id)),
      withDuctum(buildRetryCommand(record.run.id)),
    ].join(' | '),
  }))
}

function recoveryReason(record: RunRecord): string {
  return record.run.failReason ?? record.run.blockedReason ?? `${formatAttemptPhase(record.derivedStage)} attempt has no live sibling working this active Task.`
}

function compactReason(reason: string): string {
  const normalized = reason.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 157)}...`
}

function projectColumns() {
  return [
    { key: 'project', label: 'PROJECT' },
    { key: 'repositories', label: 'REPOSITORIES', align: 'right' as const },
    { key: 'specs', label: 'SPECS', align: 'right' as const },
    { key: 'tasks', label: 'TASKS', align: 'right' as const },
    { key: 'ready', label: 'READY', align: 'right' as const },
    { key: 'attempts', label: 'ATTEMPTS', align: 'right' as const },
    { key: 'attention', label: 'NEEDS ATTENTION', align: 'right' as const },
  ]
}

function activityColumns() {
  return [
    { key: 'activeAttempts', label: 'ACTIVE ATTEMPTS', align: 'right' as const },
    { key: 'readyTasks', label: 'READY TASKS', align: 'right' as const },
    { key: 'stalledAttempts', label: 'PAST STALLS', align: 'right' as const },
    { key: 'approvalsWaiting', label: 'APPROVALS', align: 'right' as const },
    { key: 'repairNeeded', label: 'NEEDS ATTENTION', align: 'right' as const },
    { key: 'agents', label: 'AGENTS', align: 'right' as const },
    { key: 'projectAssignments', label: 'PROJECT AGENTS', align: 'right' as const },
  ]
}

function recoveryColumns() {
  return [
    { key: 'project', label: 'PROJECT' },
    { key: 'spec', label: 'SPEC' },
    { key: 'task', label: 'TASK' },
    { key: 'attempt', label: 'ATTEMPT' },
    { key: 'status', label: 'STATUS' },
    { key: 'reason', label: 'REASON' },
    { key: 'nextCommand', label: 'NEXT COMMAND' },
  ]
}

function countBy<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
