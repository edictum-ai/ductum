/**
 * Live activity feed — subscribes to /api/events/stream via SSE and
 * accumulates the most recent events into a chronological list.
 *
 * The existing useDuctumSSE hook only invalidates react-query caches
 * on each event; this hook keeps a rolling buffer so the homepage
 * can render a "what just happened" timeline alongside the spec
 * cards. Decoupled from useDuctumSSE so the cache-invalidation
 * subscription isn't doubled up.
 */

import { useEffect, useRef, useState } from 'react'

import { buildEventStreamUrl, readStoredOperatorToken } from './event-stream-url'
import { useAllRuns } from './hooks'

export type ActivityEventKind =
  | 'dispatched'
  | 'stage_changed'
  | 'approval_requested'
  | 'gate_evaluated'
  | 'task_status_changed'

export interface ActivityEvent {
  /** Stable client-generated id (event-name + timestamp + counter). */
  id: string
  /** Wall-clock time the event was received by the browser. */
  receivedAt: string
  kind: ActivityEventKind
  /** Run id when scoped to a run. */
  runId?: string
  /** Optional human-readable headline. */
  headline: string
  /** Optional secondary detail. */
  detail?: string
  /** Optional task id when scoped to a task (status changes). */
  taskId?: string
  /** Used for navigation. */
  projectName?: string
  specName?: string
  taskName?: string
}

const MAX_EVENTS = 60

interface UseActivityFeedOptions {
  enabled?: boolean
}

/**
 * Subscribes to the SSE stream and returns a rolling list of recent
 * activity events. The list is sorted newest-first. Events that
 * reference a runId are decorated with project/spec/task names from
 * the EnrichedRun cache so the timeline can render full context
 * without an extra fetch per event.
 */
export function useActivityFeed(options: UseActivityFeedOptions = {}): ActivityEvent[] {
  const enabled = options.enabled !== false
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const counter = useRef(0)
  const { data: runs = [] } = useAllRuns({ limit: '200' })

  useEffect(() => {
    if (!enabled) return undefined

    // Build a runId → enrichment lookup. The hook re-runs whenever
    // `runs` changes so newly-dispatched runs get enriched too.
    const runMap = new Map(runs.map((r) => [r.id, r]))

    function enrich(runId: string | undefined) {
      if (runId == null) return {}
      const run = runMap.get(runId)
      if (run == null) return {}
      return {
        runId,
        projectName: run.projectName,
        specName: run.specName,
        taskName: run.taskName,
      }
    }

    function pushEvent(partial: Omit<ActivityEvent, 'id' | 'receivedAt'>) {
      counter.current += 1
      const event: ActivityEvent = {
        id: `${partial.kind}-${Date.now()}-${counter.current}`,
        receivedAt: new Date().toISOString(),
        ...partial,
      }
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
    }

    const source = new EventSource(buildEventStreamUrl({}, readStoredOperatorToken()))

    source.addEventListener('run.dispatched', (e) => {
      const data = JSON.parse(e.data) as { runId: string; agentName: string; stage: string }
      const enriched = enrich(data.runId)
      pushEvent({
        kind: 'dispatched',
        ...enriched,
        headline: `${enriched.taskName ?? 'task'} dispatched to ${data.agentName}`,
      })
    })

    source.addEventListener('run.stage_changed', (e) => {
      const data = JSON.parse(e.data) as { runId: string; from: string; to: string; reason?: string }
      const enriched = enrich(data.runId)
      pushEvent({
        kind: 'stage_changed',
        ...enriched,
        headline: `${enriched.taskName ?? 'run'}: ${data.from} → ${data.to}`,
        detail: data.reason,
      })
    })

    source.addEventListener('task.status_changed', (e) => {
      const data = JSON.parse(e.data) as { taskId: string; from: string; to: string }
      pushEvent({
        kind: 'task_status_changed',
        taskId: data.taskId,
        headline: `task status: ${data.from} → ${data.to}`,
      })
    })

    source.addEventListener('approval.requested', (e) => {
      const data = JSON.parse(e.data) as { runId: string }
      const enriched = enrich(data.runId)
      pushEvent({
        kind: 'approval_requested',
        ...enriched,
        headline: `${enriched.taskName ?? 'run'} is awaiting approval`,
      })
    })

    source.addEventListener('gate.evaluated', (e) => {
      const data = JSON.parse(e.data) as { runId: string; gateType: string; result: string }
      const enriched = enrich(data.runId)
      pushEvent({
        kind: 'gate_evaluated',
        ...enriched,
        headline: `gate ${data.gateType} → ${data.result}`,
      })
    })

    return () => source.close()
  }, [enabled, runs])

  return events
}
