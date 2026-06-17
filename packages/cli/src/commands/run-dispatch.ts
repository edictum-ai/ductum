import type { Run, Task } from '@ductum/core'

import type { DuctumApi } from '../api-client.js'
import type { CliContext } from '../runtime.js'
import {
  findOpenWorkflowFollowup,
  loadWorkspaceSnapshot,
  type WorkflowFollowupRecord,
} from './status-data.js'
import { formatAttemptPhase } from './status-overview.js'

function isRunTerminal(run: Run): boolean {
  return run.stage === 'done' || run.terminalState != null
}
const POLL_INTERVAL_MS = 2000

interface RunEventData {
  type: string
  runId?: string
  from?: string
  to?: string
  reason?: string
  kind?: string
  content?: string
  toolName?: string | null
}

/**
 * Parse SSE events from a streaming fetch response body.
 * Yields {event, data} pairs for each complete SSE message.
 */
async function* readSSEEvents(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = response.body?.getReader()
  if (reader == null) return

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let currentData = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7)
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6)
        } else if (line === '') {
          if (currentEvent !== '' || currentData !== '') {
            yield { event: currentEvent, data: currentData }
            currentEvent = ''
            currentData = ''
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Format a single SSE event for terminal display.
 */
function formatRunEvent(event: string, data: RunEventData): string | null {
  switch (event) {
    case 'run.stage_changed':
      return `  ${formatAttemptPhase(data.from)} -> ${formatAttemptPhase(data.to)}${data.reason != null ? `  ${data.reason}` : ''}`
    case 'run.agent_activity':
      if (data.kind === 'tool_call') {
        return `  [tool] ${data.toolName ?? 'unknown'}`
      }
      if (data.kind === 'text') {
        const preview = (data.content ?? '').slice(0, 120)
        return `  ${preview}${(data.content ?? '').length > 120 ? '…' : ''}`
      }
      return null
    case 'run.evidence_attached':
      return '  [evidence attached]'
    case 'run.heartbeat':
      return null
    case 'ping':
      return null
    default:
      return null
  }
}

export interface ResolvedTask {
  task: Task
  projectName: string
  specName: string
}

export interface StreamRunProgressResult {
  run: Run
  followup: WorkflowFollowupRecord | null
}

/**
 * Resolve a task by name within the workspace.
 * If projectName is given, only search within that project's specs.
 * Returns the task along with the resolved project name.
 */
export async function resolveTaskByName(
  api: DuctumApi,
  taskRef: string,
  projectName?: string,
  specName?: string,
): Promise<ResolvedTask> {
  const snapshot = await loadWorkspaceSnapshot(api)

  let candidates = snapshot.tasks.filter((t) => t.id === taskRef)
  if (candidates.length === 0) {
    candidates = snapshot.tasks.filter((t) => t.name === taskRef)
  }

  if (projectName != null) {
    const project = snapshot.projects.find((p) => p.name === projectName)
    if (project == null) {
      throw new Error(`Project not found: ${projectName}`)
    }
    const projectSpecIds = new Set(
      snapshot.specs.filter((s) => s.projectId === project.id).map((s) => s.id),
    )
    candidates = candidates.filter((t) => projectSpecIds.has(t.specId))
  }

  if (specName != null) {
    const specIds = new Set(snapshot.specs.filter((s) => s.name === specName).map((s) => s.id))
    candidates = candidates.filter((t) => specIds.has(t.specId))
  }

  if (candidates.length === 0) {
    throw new Error(
      projectName != null
        ? `Task not found: "${taskRef}" in project "${projectName}"${specName == null ? '' : ` spec "${specName}"`}`
        : `Task not found: "${taskRef}"`,
    )
  }

  if (candidates.length > 1) {
    const specs = new Map(snapshot.specs.map((s) => [s.id, s]))
    const projects = new Map(snapshot.projects.map((p) => [p.id, p]))
    const locations = candidates.map((t) => {
      const spec = specs.get(t.specId)
      const proj = spec == null ? null : projects.get(spec.projectId)
      return `  ${t.id} (${proj?.name ?? '?'}/${spec?.name ?? '?'})`
    })
    throw new Error(
      `Ambiguous task "${taskRef}" — found ${candidates.length} matches. Use the task id from \`ductum task list\`, or add --project and --spec:\n${locations.join('\n')}`,
    )
  }

  const task = candidates[0]!
  const specById = new Map(snapshot.specs.map((s) => [s.id, s]))
  const projectById = new Map(snapshot.projects.map((p) => [p.id, p]))
  const spec = specById.get(task.specId)
  const resolvedProject = spec == null ? undefined : projectById.get(spec.projectId)

  return { task, projectName: resolvedProject?.name ?? 'unknown', specName: spec?.name ?? 'unknown' }
}

/**
 * Stream run progress via SSE, falling back to polling.
 * Returns the final run when a terminal stage is reached.
 */
export async function streamRunProgress(
  ctx: CliContext,
  runId: string,
): Promise<StreamRunProgressResult> {
  const abort = new AbortController()
  let sseConnected = false

  // Start SSE in background for real-time event streaming
  const ssePromise = (async (): Promise<StreamRunProgressResult | null> => {
    try {
      const url = `${ctx.apiUrl}/api/events/stream?runId=${encodeURIComponent(runId)}`
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok || response.body == null) {
        return null
      }
      sseConnected = true

      for await (const event of readSSEEvents(response, abort.signal)) {
        const line = formatRunEvent(event.event, event.data !== '' ? JSON.parse(event.data) as RunEventData : {} as RunEventData)
        if (line != null) {
          ctx.writeText(line)
        }

        if (event.event === 'run.stage_changed') {
          const data = JSON.parse(event.data) as RunEventData
          if (data.to === 'done' || data.to === 'failed' || data.to === 'stalled') {
            abort.abort()
            return { run: await ctx.api.getRun(runId), followup: null }
          }
        }
      }
    } catch {
      // SSE failed or was aborted — fall through
    }
    return null
  })()

  // Poll for terminal state — check immediately, then every POLL_INTERVAL_MS
  const pollPromise = (async (): Promise<StreamRunProgressResult | null> => {
    let lastStage = ''
    let first = true

    while (!abort.signal.aborted) {
      if (!first) {
        await sleep(POLL_INTERVAL_MS)
      }
      first = false
      if (abort.signal.aborted) break

      try {
        const run = await ctx.api.getRun(runId)
        // Print stage transitions when SSE is not connected
        if (!sseConnected && run.stage !== lastStage) {
          ctx.writeText(`  ${formatAttemptPhase(run.stage)}`)
          lastStage = run.stage
        }
        if (isRunTerminal(run)) {
          abort.abort()
          return { run, followup: null }
        }
        const followup = await findFollowup(ctx.api, run)
        if (followup != null) {
          abort.abort()
          return { run, followup }
        }
      } catch {
        // Transient fetch error — keep polling
      }
    }
    return null
  })()

  const results = await Promise.allSettled([ssePromise, pollPromise])
  abort.abort()

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value != null) {
      return result.value
    }
  }

  return { run: await ctx.api.getRun(runId), followup: null }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function findFollowup(api: DuctumApi, run: Pick<Run, 'taskId'>): Promise<WorkflowFollowupRecord | null> {
  const snapshot = await loadWorkspaceSnapshot(api)
  return findOpenWorkflowFollowup(snapshot, run)
}
