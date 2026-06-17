import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { DuctumEvent, DuctumEventRecord } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { envelope } from '../lib/envelope.js'
import { publicOutput } from '../lib/public-output.js'
import type { SuggestedAction } from '../lib/errors-structured.js'

interface EventFilters {
  runId?: string
  taskId?: string
  specId?: string
  projectId?: string
}

function resolveScope(context: ApiContext, event: DuctumEvent): EventFilters {
  if ('runId' in event) {
    const run = context.repos.runs.get(event.runId)
    const task = run == null ? null : context.repos.tasks.get(run.taskId)
    const spec = task == null ? null : context.repos.specs.get(task.specId)
    return {
      runId: event.runId,
      taskId: task?.id,
      specId: spec?.id,
      projectId: spec?.projectId,
    }
  }
  if ('taskId' in event) {
    const task = context.repos.tasks.get(event.taskId)
    const spec = task == null ? null : context.repos.specs.get(task.specId)
    return {
      taskId: event.taskId,
      specId: spec?.id,
      projectId: spec?.projectId,
    }
  }
  if ('specId' in event) {
    const spec = context.repos.specs.get(event.specId)
    return { specId: event.specId, projectId: spec?.projectId }
  }
  return {}
}

function matches(filters: EventFilters, scope: EventFilters) {
  return (
    (filters.runId == null || filters.runId === scope.runId) &&
    (filters.taskId == null || filters.taskId === scope.taskId) &&
    (filters.specId == null || filters.specId === scope.specId) &&
    (filters.projectId == null || filters.projectId === scope.projectId)
  )
}

export function registerEventRoutes(app: Hono, context: ApiContext) {
  app.get('/api/events', (c) => {
    const lastEventId = c.req.header('last-event-id')
    const heartbeatMs = resolveEventsHeartbeatMs()

    return streamSSE(c, async (stream) => {
      let closed = false
      const writeRecord = async (record: DuctumEventRecord) => {
        if (closed || stream.aborted) return
        const normalized = normalizeEvent(context, record)
        if (normalized == null) return
        await stream.writeSSE({
          id: record.id,
          event: normalized.kind,
          data: JSON.stringify(envelope(normalized.kind, publicOutput(normalized.data), () => new Date(record.ts))),
        })
      }
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        stream.abort()
      }
      const unsubscribe = context.events.subscribeRecords((record) => {
        void writeRecord(record)
      })

      stream.onAbort(close)
      c.req.raw.signal.addEventListener('abort', close, { once: true })

      for (const record of context.events.getAfter(lastEventId)) {
        await writeRecord(record)
      }

      while (!stream.aborted) {
        await stream.sleep(heartbeatMs)
        if (stream.aborted) break
        const record = context.events.record({
          type: 'factory.events_stream_resumed',
          lastEventId: context.events.lastEventId(),
        })
        await writeRecord(record)
      }
    })
  })

  app.get('/api/events/stream', (c) => {
    const filters: EventFilters = {
      runId: c.req.query('runId'),
      taskId: c.req.query('taskId'),
      specId: c.req.query('specId'),
      projectId: c.req.query('projectId'),
    }

    return streamSSE(c, async (stream) => {
      let closed = false
      const close = () => {
        if (closed) {
          return
        }
        closed = true
        unsubscribe()
        stream.abort()
      }
      const unsubscribe = context.events.subscribe((event) => {
        if (closed || !matches(filters, resolveScope(context, event))) {
          return
        }
        void stream.writeSSE({ event: event.type, data: JSON.stringify(publicOutput(event)) })
      })

      stream.onAbort(close)
      c.req.raw.signal.addEventListener('abort', close, { once: true })
      await stream.writeSSE({ event: 'ready', data: '{}' })

      while (!stream.aborted) {
        await stream.sleep(15000)
        if (stream.aborted) {
          break
        }
        await stream.writeSSE({ event: 'ping', data: '{}' })
      }
    })
  })
}

function resolveEventsHeartbeatMs(): number {
  const raw = process.env.DUCTUM_EVENTS_HEARTBEAT_MS
  if (raw == null || raw.trim() === '') return 30000
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000
}

interface NormalizedEvent {
  kind: string
  data: Record<string, unknown>
}

function normalizeEvent(context: ApiContext, record: DuctumEventRecord): NormalizedEvent | null {
  const event = record.event
  if (event.type === 'approval.requested') return null
  if (event.type === 'run.failed') return normalizeRunFailed(context, record, event)
  if (event.type === 'run.completed') return normalizeRunCompleted(context, event)
  const { type, ...data } = event
  return { kind: type, data }
}

function normalizeRunFailed(
  context: ApiContext,
  record: DuctumEventRecord,
  event: Extract<DuctumEvent, { type: 'run.failed' }>,
): NormalizedEvent {
  const message = event.failReason ?? 'run failed'
  const suggestedActions = suggestedActionsForRunFailure(context, event)
  return {
    kind: 'run.failed',
    data: {
      runId: event.runId,
      failReason: publicOutput(event.failReason),
      error: envelope('error', {
        code: event.failReason === 'max_turns_reached' ? 'max_turns_reached' : 'run_failed',
        message: publicOutput(message),
        recoverable: suggestedActions.length > 0,
        suggestedActions: publicOutput(suggestedActions),
        context: { runId: event.runId },
      }, () => new Date(record.ts)),
    },
  }
}

const BASE_CLAUDE_MAX_TURNS = 200

function suggestedActionsForRunFailure(
  context: ApiContext,
  event: Extract<DuctumEvent, { type: 'run.failed' }>,
): SuggestedAction[] {
  if (event.failReason !== 'max_turns_reached') return []
  const run = context.repos.runs.get(event.runId)
  const task = run == null ? null : context.repos.tasks.get(run.taskId)
  const currentAgent = run == null ? null : context.repos.agents.get(run.agentId)
  const currentLimit = BASE_CLAUDE_MAX_TURNS + (task?.turnExtraCount ?? 0)
  const suggestedLimit = Math.max(currentLimit + 50, Math.ceil(currentLimit * 1.5))
  const byCount = suggestedLimit - currentLimit
  const candidates = context.repos.agents.list()
    .filter((agent) => agent.id !== run?.agentId)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      harness: agent.harness,
    }))

  return [
    {
      kind: 'bump_max_turns',
      description: `Inspect the Attempt, adjust Factory Settings or split the Task, then retry.`,
      cmd: `ductum status ${event.runId}`,
      args: { currentLimit, suggestedLimit },
    },
    {
      kind: 'retry_same_agent',
      description: 'Retry with the same agent.',
      ...(task != null && currentAgent != null
        ? { cmd: `ductum retry ${event.runId}` }
        : {}),
      args: { taskId: task?.id ?? null, agentName: currentAgent?.name ?? null },
    },
    {
      kind: 'switch_agent',
      description: 'Assign the Task to another Agent before retrying.',
      ...(task != null && candidates[0] != null
        ? { cmd: `ductum task assign ${task.id} ${candidates[0].name}` }
        : {}),
      args: { taskId: task?.id ?? null, candidateAgents: candidates },
    },
  ]
}

function normalizeRunCompleted(
  context: ApiContext,
  event: Extract<DuctumEvent, { type: 'run.completed' }>,
): NormalizedEvent {
  const run = context.repos.runs.get(event.runId)
  return {
    kind: 'run.completed',
    data: {
      runId: event.runId,
      branch: run?.branch ?? null,
      commitSha: run?.commitSha ?? null,
      mergeSha: run?.commitSha ?? null,
    },
  }
}
