import type { Agent, DispatcherStatus, Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import {
  buildExecutionIntegrityReport,
  type ExecutionIntegrityIssueSample,
  type ExecutionIntegrityReport,
} from './execution-integrity.js'
import { openWorkflowFollowupForRun } from './run-workflow-followup.js'
import { getTelegramStatus } from './telegram-runtime.js'

/**
 * Read-only factory summary used by repair and dashboard surfaces:
 * dispatcher health, activity counts, telegram wiring, registered
 * agents, and short recommended next actions.
 *
 * Sensitive values (operator token, Telegram bot token / chat id /
 * webhook secret) never leave the server. Only the public webhook URL
 * is surfaced, and only when the operator already configured a
 * publicBaseUrl.
 */
export interface OperatorBrief {
  generatedAt: string
  staleSlotsAutoClosed: number
  dispatcher: OperatorBriefDispatcher
  queue: OperatorBriefQueue
  integrity: OperatorBriefIntegrity
  telegram: OperatorBriefTelegram
  agents: OperatorBriefAgent[]
  recommendedActions: string[]
}

export interface OperatorBriefDispatcher {
  enabled: boolean
  running: boolean
  activeRuns: number
  maxConcurrentRuns: number
  lastCycleAt: string | null
  adapterCount: number
}

export interface OperatorBriefQueue {
  approvalsWaiting: number
  activeRuns: number
  readyTasks: number
  needsOperator: number
  integrityIssues: number
}

export interface OperatorBriefIntegrity {
  readiness: 'clear' | 'attention'
  issueCount: number
  taskIssueCount: number
  runIssueCount: number
  externalTaskCount: number
  externalRunCount: number
  taskModes: ExecutionIntegrityReport['summary']['taskModes']
  runModes: ExecutionIntegrityReport['summary']['runModes']
  issues: ExecutionIntegrityIssueSample[]
  issuesTruncated: boolean
}

export interface OperatorBriefTelegram {
  enabled: boolean
  configured: boolean
  webhookUrl?: string | null
  channelRef?: string
  skipped?: string
  error?: string
}

export interface OperatorBriefAgent {
  name: string
  model: string
  harness: string
  effort: string | null
  capabilities: string[]
}

const AGENT_LIMIT = 20

export function buildOperatorBrief(
  context: ApiContext,
  options: { now: Date },
): OperatorBrief {
  const integrityReport = buildExecutionIntegrityReport(context)
  const dispatcher = buildDispatcher(context)
  const queue = buildQueue(context, integrityReport)
  const integrity = buildIntegrity(integrityReport)
  const telegram = buildTelegram(context)
  const agents = context.repos.agents
    .list()
    .slice(0, AGENT_LIMIT)
    .map(toBriefAgent)

  return {
    generatedAt: options.now.toISOString(),
    staleSlotsAutoClosed: countStaleSlotsAutoClosed(context),
    dispatcher,
    queue,
    integrity,
    telegram,
    agents,
    recommendedActions: buildRecommendedActions({ dispatcher, queue, integrity, telegram, agents }),
  }
}

function countStaleSlotsAutoClosed(context: ApiContext): number {
  const row = context.db
    .prepare(
      "SELECT COUNT(*) AS c FROM runs WHERE terminal_state = 'stalled' AND fail_reason = 'stale_slot_gc'",
    )
    .get() as { c: number } | undefined
  return row?.c ?? 0
}

function buildDispatcher(context: ApiContext): OperatorBriefDispatcher {
  const status = resolveDispatcherStatus(context)
  return {
    enabled: status.enabled,
    running: status.running,
    activeRuns: status.activeRuns,
    maxConcurrentRuns: status.maxConcurrentRuns,
    lastCycleAt: status.lastCycleAt,
    adapterCount: status.adapterCount,
  }
}

function resolveDispatcherStatus(context: ApiContext): DispatcherStatus {
  if (context.getDispatcherStatus != null) return context.getDispatcherStatus()
  return {
    running: false,
    activeRuns: context.repos.runs.getActive().length,
    maxConcurrentRuns: 0,
    lastCycleAt: null,
    enabled: false,
    adapterCount: 0,
    adapters: [],
    reason: 'dispatcher support not loaded',
  }
}

function buildQueue(context: ApiContext, integrityReport: ExecutionIntegrityReport): OperatorBriefQueue {
  const recentRuns = context.repos.runs.listAll({ limit: 1000 })
  const leaves = toLeafRuns(recentRuns)
    .filter(isOpenRun)
    .filter((run) => openWorkflowFollowupForRun(context.repos.tasks, run) == null)
  const approvalsWaiting = leaves.filter(isAwaitingApproval).length
  const running = leaves.length - approvalsWaiting
  const readyTasks = countReadyTasks(context)
  const needsOperator = countNeedsOperatorRuns(context)
  const integrityIssues = integrityReport.summary.issueCount
  return { approvalsWaiting, activeRuns: running, readyTasks, needsOperator, integrityIssues }
}

function buildIntegrity(report: ExecutionIntegrityReport): OperatorBriefIntegrity {
  const externalTaskCount = report.summary.taskModes.external ?? 0
  const externalRunCount = report.summary.runModes.external ?? 0
  return {
    readiness: report.summary.issueCount === 0 ? 'clear' : 'attention',
    issueCount: report.summary.issueCount,
    taskIssueCount: report.summary.taskIssueCount,
    runIssueCount: report.summary.runIssueCount,
    externalTaskCount,
    externalRunCount,
    taskModes: report.summary.taskModes,
    runModes: report.summary.runModes,
    issues: report.summary.issues,
    issuesTruncated: report.summary.issuesTruncated,
  }
}

function toLeafRuns(runs: Run[]): Run[] {
  const childrenByParent = new Map<string, Run[]>()
  for (const run of runs) {
    if (run.parentRunId == null) continue
    const children = childrenByParent.get(run.parentRunId) ?? []
    children.push(run)
    childrenByParent.set(run.parentRunId, children)
  }

  const hasOpenDescendant = (run: Run) => {
    const stack = [...(childrenByParent.get(run.id) ?? [])]
    while (stack.length > 0) {
      const child = stack.pop()!
      if (isOpenRun(child)) return true
      stack.push(...(childrenByParent.get(child.id) ?? []))
    }
    return false
  }

  return runs.filter((run) => !hasOpenDescendant(run))
}

function isOpenRun(run: Run): boolean {
  return run.stage !== 'done' && run.terminalState == null
}

function isAwaitingApproval(run: Run): boolean {
  return run.stage === 'ship' && run.pendingApproval
}

/**
 * Count latest terminal runs that still need human attention on an
 * otherwise-open task/review leaf: failed/stalled/quarantined/frozen
 * states plus cancelled runs whose worktree was intentionally preserved.
 * Mirrors the repair-needed bucket so the brief and status/dashboard
 * counts agree.
 */
function countNeedsOperatorRuns(context: ApiContext): number {
  const rows = context.db
    .prepare(
      `
        SELECT r.id AS runId
        FROM runs r
        JOIN tasks t ON t.id = r.task_id
        WHERE (
            t.status = 'active'
            OR (t.status = 'failed' AND (t.required_role = 'reviewer' OR t.strategy_role = 'blind_review'))
          )
          AND r.terminal_state IN ('failed', 'stalled', 'quarantined', 'frozen', 'cancelled')
          AND r.id = (
            SELECT latest.id
            FROM runs latest
            WHERE latest.task_id = r.task_id
            ORDER BY latest.created_at DESC, latest.updated_at DESC, latest.id DESC
            LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM runs r2
            WHERE r2.task_id = r.task_id
              AND r2.terminal_state IS NULL
              AND NOT (r2.stage = 'ship' AND r2.pending_approval = 1)
          )
      `,
    )
    .all() as Array<{ runId: Run['id'] }>
  return rows.filter(({ runId }) => {
    const run = context.repos.runs.get(runId)
    return run != null && runNeedsOperator(run, context)
  }).length
}

function runNeedsOperator(run: Run, context: ApiContext): boolean {
  return run.terminalState === 'failed'
    || run.terminalState === 'stalled'
    || run.terminalState === 'quarantined'
    || run.terminalState === 'frozen'
    || isCancelledDirtyTerminalRun(run, context)
}

function isCancelledDirtyTerminalRun(run: Run, context: ApiContext): boolean {
  if (run.terminalState !== 'cancelled') return false
  if ((run.worktreePaths?.length ?? 0) === 0) return false
  return context.repos.evidence.list(run.id).some((item) =>
    item.type === 'custom'
      && item.payload.kind === 'operator.cancel'
      && item.payload.worktreePreserved === true
      && item.payload.dirtyWorktree === true,
  )
}

function countReadyTasks(context: ApiContext): number {
  const row = context.db
    .prepare(
      `
        SELECT COUNT(*) AS c
        FROM tasks t
        WHERE t.status = 'ready'
          AND NOT EXISTS (
            SELECT 1
            FROM task_dependencies td
            JOIN tasks dep ON dep.id = td.depends_on_id
            WHERE td.task_id = t.id
              AND (
                (COALESCE(t.strategy_role, 'normal') = 'blind_review' AND dep.status NOT IN ('done', 'failed'))
                OR (COALESCE(t.strategy_role, 'normal') != 'blind_review' AND dep.status != 'done')
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM runs r
            WHERE r.task_id = t.id
              AND r.stage != 'done'
              AND r.terminal_state IS NULL
          )
      `,
    )
    .get() as { c: number } | undefined
  return row?.c ?? 0
}

function buildTelegram(context: ApiContext): OperatorBriefTelegram {
  const status = getTelegramStatus(context)
  const brief: OperatorBriefTelegram = {
    enabled: status.enabled,
    configured: status.configured,
  }
  if (status.webhookUrl != null) brief.webhookUrl = status.webhookUrl
  if (status.channelRef != null) brief.channelRef = status.channelRef
  if (status.skipped != null) brief.skipped = status.skipped
  if (status.error != null) brief.error = status.error
  return brief
}

function toBriefAgent(agent: Agent): OperatorBriefAgent {
  return {
    name: agent.name,
    model: agent.model,
    harness: agent.harness,
    effort: agent.effort ?? null,
    capabilities: [...agent.capabilities],
  }
}

function buildRecommendedActions(input: {
  dispatcher: OperatorBriefDispatcher
  queue: OperatorBriefQueue
  integrity: OperatorBriefIntegrity
  telegram: OperatorBriefTelegram
  agents: OperatorBriefAgent[]
}): string[] {
  const actions: string[] = []
  const { dispatcher, queue, integrity, telegram, agents } = input

  if (telegram.error != null) {
    actions.push(
      `Fix Telegram notification channel${telegram.channelRef == null ? '' : ` ${telegram.channelRef}`}: ${telegram.error}.`,
    )
  }
  if (queue.approvalsWaiting > 0) {
    actions.push(
      `Resolve ${queue.approvalsWaiting} approval${plural(queue.approvalsWaiting)} with \`ductum approve <attemptId>\` or \`ductum deny <attemptId> --reason ...\` (inspect with \`ductum status\`).`,
    )
  }
  if (queue.needsOperator > 0) {
    actions.push(
      `Review ${queue.needsOperator} failed/stalled/quarantined Attempt${plural(queue.needsOperator)} (cancelled dirty worktrees and frozen budget/turn halts included) — inspect with \`ductum status <attemptId>\`, then \`ductum retry <attemptId>\` or resume as appropriate.`,
    )
  }
  if (queue.integrityIssues > 0) {
    const samples = integrity.issues.slice(0, 3)
    const suffix = samples.length === 0
      ? ''
      : ` Sample issues: ${samples
        .map((issue) => `${issue.scope} ${issue.projectName}/${issue.specName}/${issue.taskName} ${issue.issueCode}`)
        .join('; ')}.`
    const truncated = integrity.issuesTruncated ? ` Showing first ${integrity.issues.length}.` : ''
    actions.push(
      `Review ${queue.integrityIssues} execution integrity issue${plural(queue.integrityIssues)} (${integrity.taskIssueCount} task, ${integrity.runIssueCount} run) with \`ductum repair\`.${suffix}${truncated}`,
    )
  }
  if (integrity.externalTaskCount + integrity.externalRunCount > 0) {
    actions.push(
      `Review ${integrity.externalTaskCount + integrity.externalRunCount} externally recorded item${plural(integrity.externalTaskCount + integrity.externalRunCount)} with \`ductum repair\`; these are explicit outcomes, not Ductum-authored lineage.`,
    )
  }
  if (queue.readyTasks > 0) {
    const verb = dispatcher.running ? 'monitor' : 'dispatch'
    actions.push(
      `${queue.readyTasks} ready Task${plural(queue.readyTasks)} waiting — ${verb} via \`ductum status\` or \`ductum attempt start <taskId> --agent <name> --project <name>\`.`,
    )
  }
  if (queue.activeRuns > 0) {
    actions.push(
      `${queue.activeRuns} active Attempt${plural(queue.activeRuns)} in progress — monitor with \`ductum status\` or \`ductum watch <attemptId>\`.`,
    )
  }
  if (!dispatcher.enabled) {
    actions.push('Dispatcher is disabled — restart the Ductum API with dispatch enabled so ready tasks auto-dispatch.')
  } else if (!dispatcher.running) {
    actions.push('Dispatcher is enabled but not running — restart the Ductum API to resume auto-dispatch.')
  }
  if (agents.length === 0) {
    actions.push('No enabled Agents are available — run `ductum repair` and configure Factory Settings.')
  }
  if (actions.length === 0) {
    actions.push('Factory is idle — inspect with `ductum status` or create new work with `ductum spec create <project> <name>`.')
  }
  return actions
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
