import type { DuctumEvent } from '@ductum/core'
import { Command } from 'commander'

import { operatorTokenHeaders } from '../api-request.js'
import { formatDisplayStatus, formatRunLabel, formatSummaryRows } from '../format.js'
import { openEventStream } from '../event-stream.js'
import { createAction } from '../runtime.js'
import type { CliContext, CliProgramDeps } from '../runtime.js'
import { formatRunCost, renderSections } from './common.js'
import {
  buildAttemptStartCommand,
  buildApprovalNextCommand,
  buildRetryCommand,
  buildStatusCommand,
} from './attempt-actions.js'
import {
  findRunRecord,
  listActiveRuns,
  listNeedsOperatorRuns,
  listReadyTasks,
  listTaskRecords,
  listWaitingApprovalRuns,
  loadWorkspaceSnapshot,
} from './status-data.js'
import { formatAttemptPhase, titleLabel } from './status-overview.js'

interface WatchOptions {
  project?: string
  spec?: string
  task?: string
  once?: boolean
  timeout?: string
}

type WatchEvent = Extract<
  DuctumEvent,
  | { type: 'run.stage_changed' }
  | { type: 'run.dispatched' }
  | { type: 'approval.requested' }
  | { type: 'task.status_changed' }
  | { type: 'spec.status_changed' }
  | { type: 'run.agent_activity' }
  | { type: 'gate.evaluated' }
  | { type: 'workflow.advanced' }
>

export function registerWatchCommand(program: Command, deps: CliProgramDeps) {
  program
    .command('watch [attemptId]')
    .description('Watch Factory Activity or a single Attempt')
    .option('--project <id>', 'Stream only events for a project id')
    .option('--spec <id>', 'Stream only events for a spec id')
    .option('--task <id>', 'Stream only events for a task id')
    .option('--once', 'Print the initial snapshot and exit')
    .option('--timeout <seconds>', 'Exit after the given number of seconds')
    .action(createAction(deps, async (ctx, attemptId?: string, options: WatchOptions = {}) => {
      const snapshot = await loadWorkspaceSnapshot(ctx.api)
      const refs = createRefs(snapshot, ctx.now())

      if (attemptId == null) {
        const activity = buildFactoryActivitySnapshot(snapshot, ctx.now())
        writeWatchOutput(ctx, { kind: 'snapshot', scope: 'factory_activity', ...activity }, renderFactoryActivitySnapshot(activity))
      } else {
        const run = await ctx.api.getRun(attemptId)
        const record = findRunRecord(snapshot, attemptId, ctx.now())
        writeWatchOutput(
          ctx,
          { kind: 'snapshot', scope: 'attempt', attempt: run, record },
          renderRunSnapshot(run, record),
        )
      }

      if (options.once) {
        return
      }

      const abort = new AbortController()
      const timeoutMs = parseTimeoutMs(options.timeout)
      const openStream = deps.openEventStream ?? openEventStream
      const timer = timeoutMs == null ? null : setTimeout(() => abort.abort(), timeoutMs)

      try {
        for await (const message of openStream({
          url: buildStreamUrl(ctx, attemptId, options),
          signal: abort.signal,
          headers: operatorTokenHeaders(ctx.env),
        })) {
          const event = parseWatchEvent(message.event, message.data)
          if (event == null) {
            continue
          }
          const line = formatWatchEvent(event, refs)
          if (line == null) {
            continue
          }
          writeWatchOutput(ctx, { kind: 'event', event: event.type, data: event }, line)
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          throw error
        }
      } finally {
        if (timer != null) {
          clearTimeout(timer)
        }
      }
    }))
}

function createRefs(snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>>, now: Date) {
  return {
    runs: new Map(listActiveRuns(snapshot, now).concat(listNeedsOperatorRuns(snapshot, now), listWaitingApprovalRuns(snapshot, now)).map(
      (record) => [record.run.id, formatRunLabel(record.project.name, record.task.name, record.run.id)],
    )),
    tasks: new Map(listTaskRecords(snapshot).map((record) => [record.task.id, `${record.task.name} [${record.task.id}]`])),
    specs: new Map(snapshot.specs.map((item) => [item.id, `${item.name} [${item.id}]`])),
  }
}

function buildFactoryActivitySnapshot(snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>>, now: Date) {
  const approvalsWaiting = listWaitingApprovalRuns(snapshot, now)
  const activeAttempts = listActiveRuns(snapshot, now)
  const readyTasks = listReadyTasks(snapshot)
  const needsOperator = listNeedsOperatorRuns(snapshot, now)
  return {
    counts: {
      approvalsWaiting: approvalsWaiting.length,
      activeAttempts: activeAttempts.length,
      readyTasks: readyTasks.length,
      needsOperator: needsOperator.length,
    },
    // #275: include the FULL run ID alongside the short label so operators
    // can copy/paste into cancel/retry/logs/status without an extra lookup.
    // Label stays as project/task/shortId for compactness; the trailing
    // [ID: ...] segment carries the value follow-up commands require.
    approvalsWaiting: approvalsWaiting.map((record) => `${formatRunLabel(record.project.name, record.task.name, record.run.id)} [ID: ${record.run.id}] -> ${buildApprovalNextCommand(record.run)}`),
    activeAttempts: activeAttempts.map((record) => `${formatRunLabel(record.project.name, record.task.name, record.run.id)} [ID: ${record.run.id}] -> ${buildStatusCommand(record.run.id)}`),
    readyTasks: readyTasks.map((record) => `${record.project.name}/${record.task.name} [${record.task.id}] -> ${buildAttemptStartCommand(record)}`),
    needsOperator: needsOperator.map((record) => `${formatRunLabel(record.project.name, record.task.name, record.run.id)} [ID: ${record.run.id}] -> ${buildRetryCommand(record.run.id)}`),
  }
}

function renderFactoryActivitySnapshot(activity: ReturnType<typeof buildFactoryActivitySnapshot>) {
  return renderSections(
    'Factory Activity',
    formatSummaryRows({
      'Approvals waiting': activity.counts.approvalsWaiting,
      'Active attempts': activity.counts.activeAttempts,
      'Ready tasks': activity.counts.readyTasks,
      'Action needed': activity.counts.needsOperator,
    }),
    renderWatchSection('Approvals Waiting', activity.approvalsWaiting),
    renderWatchSection('Action Needed', activity.needsOperator),
    renderWatchSection('Ready Tasks', activity.readyTasks),
    renderWatchSection('Active Attempts', activity.activeAttempts),
  )
}

function renderRunSnapshot(run: Awaited<ReturnType<CliContext['api']['getRun']>>, record: ReturnType<typeof findRunRecord>) {
  return renderSections(
    'Attempt Status',
    formatSummaryRows({
      attemptId: run.id,
      status: formatDisplayStatus(run),
      phase: formatAttemptPhase(record?.derivedStage ?? run.stage),
      result: run.terminalState == null ? '' : formatAttemptPhase(run.terminalState),
      task: record?.task.name ?? run.taskId,
      project: record?.project.name ?? '',
      agent: record?.agent?.name ?? run.agentId,
      branch: run.branch ?? '',
      commitSha: run.commitSha ?? '',
      prUrl: run.prUrl ?? '',
      costUsd: formatRunCost(run),
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
    }),
  )
}

function renderWatchSection(title: string, items: string[]) {
  return `${title}\n${items.length === 0 ? '(empty)' : items.join('\n')}`
}

function buildStreamUrl(ctx: CliContext, runId: string | undefined, options: WatchOptions) {
  const params = new URLSearchParams()
  if (runId != null) params.set('runId', runId)
  if (options.project != null) params.set('projectId', options.project)
  if (options.spec != null) params.set('specId', options.spec)
  if (options.task != null) params.set('taskId', options.task)
  const query = params.toString()
  return `${ctx.apiUrl.replace(/\/+$/, '')}/api/events/stream${query === '' ? '' : `?${query}`}`
}

function parseTimeoutMs(value: string | undefined) {
  if (value == null) {
    return null
  }
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout: ${value}`)
  }
  return Math.round(seconds * 1000)
}

function parseWatchEvent(eventName: string, data: string): WatchEvent | null {
  if (eventName === 'ping' || !isWatchEventType(eventName)) {
    return null
  }
  return JSON.parse(data) as WatchEvent
}

const WATCH_EVENTS = new Set<WatchEvent['type']>([
  'run.stage_changed',
  'run.dispatched',
  'approval.requested',
  'task.status_changed',
  'spec.status_changed',
  'run.agent_activity',
  'gate.evaluated',
  'workflow.advanced',
])

function isWatchEventType(value: string): value is WatchEvent['type'] {
  return WATCH_EVENTS.has(value as WatchEvent['type'])
}

function formatWatchEvent(event: WatchEvent, refs: ReturnType<typeof createRefs>) {
  switch (event.type) {
    case 'run.stage_changed':
      return `${refs.runs.get(event.runId) ?? event.runId}: ${formatAttemptPhase(event.from)} -> ${formatAttemptPhase(event.to)}${event.reason == null ? '' : ` (${event.reason})`}`
    case 'run.dispatched':
      return `${refs.runs.get(event.runId) ?? event.runId}: dispatched to ${event.agentName} @ ${formatAttemptPhase(event.stage)}`
    case 'approval.requested':
      return `approval requested: ${refs.runs.get(event.runId) ?? event.runId}`
    case 'task.status_changed':
      return `${refs.tasks.get(event.taskId) ?? event.taskId}: ${titleLabel(event.from)} -> ${titleLabel(event.to)}`
    case 'spec.status_changed':
      return `${refs.specs.get(event.specId) ?? event.specId}: ${titleLabel(event.from)} -> ${titleLabel(event.to)}`
    case 'run.agent_activity':
      return formatAgentActivity(event, refs.runs.get(event.runId) ?? event.runId)
    case 'gate.evaluated':
      return `${refs.runs.get(event.runId) ?? event.runId}: gate ${formatAttemptPhase(event.gateType)} -> ${titleLabel(event.result)}`
    case 'workflow.advanced':
      return `${refs.runs.get(event.runId) ?? event.runId}: workflow advanced from ${formatAttemptPhase(event.fromStage)} (${event.events.length} event(s))`
  }
}

function formatAgentActivity(event: Extract<WatchEvent, { type: 'run.agent_activity' }>, label: string) {
  if (event.kind === 'tool_call') {
    return `${label}: tool ${event.toolName ?? 'unknown'}`
  }
  if (event.kind === 'tool_result') {
    return `${label}: tool result ${event.toolName ?? 'unknown'}`
  }
  const preview = event.content.replace(/\s+/g, ' ').trim().slice(0, 120)
  return `${label}: ${event.kind}${preview === '' ? '' : ` ${preview}`}`
}

function writeWatchOutput(ctx: CliContext, value: unknown, text: string) {
  if (ctx.json) {
    ctx.writeText(JSON.stringify(value))
    return
  }
  ctx.writeText(text)
}
