import type { Agent, DispatcherMcpServer, Run, RunId, SpawnOptions, Task } from '@ductum/core'
import { log } from '@ductum/core'
import { fileURLToPath } from 'node:url'

import { emitHarnessEvent } from './canonical-events.js'
import { type ActivityCursor, createActivityCursor, postCompletionActivity, processNewMessages, roundUsd } from './opencode-activity.js'
import { fetchAgent } from './rest.js'
import { resolveOpenCodeModel } from './opencode-model.js'
import { buildDuctumMcpToolIds } from './opencode-probe.js'
import {
  addMcpServer,
  createSession,
  deleteSession,
  disconnectMcpServer,
  getSessionStatuses,
  listSessionMessages,
  promptSessionAsync,
} from './opencode-rest.js'
import { summarizeOpenCodeUsage } from './opencode-usage.js'
import type { HarnessAdapter, HarnessSession, HarnessSessionResult } from './types.js'

/**
 * Heartbeat interval (ms). Reads `DUCTUM_HEARTBEAT_INTERVAL_MS` from
 * the environment so operators can dial it from Factory Settings (the
 * runtime settings stored in the Factory DB) without patching the
 * harness. Defaults to 30s.
 */
const HEARTBEAT_INTERVAL_MS = (() => {
  const raw = process.env.DUCTUM_HEARTBEAT_INTERVAL_MS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000
})()
const COMPLETION_POLL_INTERVAL_MS = 1_000

/** How often (in poll ticks) to fetch messages for activity/token tracking. */
const ACTIVITY_POLL_EVERY_N_TICKS = 3

interface ActiveSession {
  sessionId: string
  runId: RunId
  controlToken: string | null
  directory: string
  mcpServerName: string
  heartbeat: NodeJS.Timeout | null
  wakeCompletionLoop: (() => void) | null
  killRequested: boolean
  /** See HarnessAdapter.kill. 'completed' signals the dispatcher is
   *  ending the session cleanly because ductum.complete was called —
   *  the finish() result should stay 'completed' so the normal
   *  post-completion pipeline runs. */
  killReason: 'killed' | 'completed'
  completed: boolean
  usagePosted: boolean
  activityCursor: ActivityCursor
  pollTick: number
  completion: Promise<HarnessSessionResult>
}

export class OpenCodeHarnessAdapter implements HarnessAdapter {
  private readonly sessions = new Map<string, ActiveSession>()

  constructor(
    private readonly apiUrl: string,
    private readonly openCodeUrl: string,
  ) {}

  async spawn(run: Run, task: Task, systemPrompt: string, _mcpServer: DispatcherMcpServer, options?: SpawnOptions): Promise<HarnessSession> {
    const agent = options?.agent ?? await fetchAgent(this.apiUrl, run.agentId)
    const directory = options?.workingDir ?? agent.spawnConfig.workingDir ?? process.cwd()
    const session = await createSession(this.openCodeUrl, directory, task.name)
    const mcpServerName = `ductum-${session.id}`

    await addMcpServer(
      this.openCodeUrl,
      directory,
      mcpServerName,
      resolveDuctumMcpCommand(agent),
      buildMcpEnvironment(this.apiUrl, run.id, agent, options?.controlToken),
    )

    const active: ActiveSession = {
      sessionId: session.id,
      runId: run.id,
      controlToken: options?.controlToken ?? null,
      directory,
      mcpServerName,
      heartbeat: null,
      wakeCompletionLoop: null,
      killRequested: false,
      killReason: 'killed',
      completed: false,
      usagePosted: false,
      activityCursor: createActivityCursor(),
      pollTick: 0,
      completion: Promise.resolve({
        exitReason: 'crashed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      }),
    }

    this.sessions.set(session.id, active)
    await emitHarnessEvent(this.apiUrl, run.id, { type: 'session.started', harnessSessionId: session.id }).catch(() => undefined)
    active.completion = this.waitForCompletion(active)

    try {
      await promptSessionAsync(this.openCodeUrl, directory, session.id, {
        system: systemPrompt,
        model: resolveOpenCodeModel(agent),
        tools: this.buildToolPermissions(active),
        parts: [{ type: 'text', text: task.prompt }],
      })
      active.heartbeat = setInterval(() => {
        void this.tickHeartbeat(active)
      }, HEARTBEAT_INTERVAL_MS)
    } catch (error) {
      await this.kill(session.id)
      throw error
    }

    return {
      sessionId: session.id,
      harnessSessionId: session.id,
      runId: run.id,
      waitForCompletion: async () => await active.completion,
    }
  }

  async kill(sessionId: string, reason: 'killed' | 'completed' | 'cancelled' = 'killed'): Promise<void> {
    const active = this.sessions.get(sessionId)
    if (active == null) {
      return
    }

    active.killRequested = true
    active.killReason = reason === 'cancelled' ? 'killed' : reason
    this.stopHeartbeat(active)
    active.wakeCompletionLoop?.()

    await Promise.allSettled([
      disconnectMcpServer(this.openCodeUrl, active.directory, active.mcpServerName),
      deleteSession(this.openCodeUrl, active.directory, active.sessionId),
    ])
    await active.completion.catch(() => undefined)
  }

  async isAlive(sessionId: string): Promise<boolean> {
    const active = this.sessions.get(sessionId)
    if (active == null || active.killRequested || active.completed) {
      return false
    }

    const status = await this.getStatus(active)
    return status != null && status.type !== 'idle'
  }

  private async waitForCompletion(active: ActiveSession): Promise<HarnessSessionResult> {
    const tag = `[opencode:${active.sessionId.slice(0, 12)}]`
    let promptStarted = false
    try {
      while (true) {
        if (active.killRequested) {
          log.info('opencode', `${tag} killed (reason=${active.killReason})`)
          return await this.finish(active, active.killReason === 'completed' ? 'completed' : 'killed')
        }

        const status = await this.getStatus(active).catch((err) => {
          log.error('opencode', `${tag} getStatus error: ${err instanceof Error ? err.message : String(err)}`)
          return null
        })

        if (status == null) {
          // Session not in status list — may not have started yet
          if (!promptStarted) {
            // Wait for promptSessionAsync to fire before treating as crash
            await waitForNextPoll(active, COMPLETION_POLL_INTERVAL_MS)
            continue
          }
          log.error('opencode', `${tag} session disappeared from status list — crashed`)
          return await this.finish(
            active,
            active.killRequested
              ? (active.killReason === 'completed' ? 'completed' : 'killed')
              : 'crashed',
          )
        }

        promptStarted = true

        if (status.type === 'idle') {
          log.info('opencode', `${tag} session idle — completed`)
          return await this.finish(active, 'completed')
        }

        // Log non-trivial statuses
        if (status.type !== 'busy') {
          log.info('opencode', `${tag} status: ${status.type}`)
        }

        if (active.killRequested) {
          return await this.finish(active, active.killReason === 'completed' ? 'completed' : 'killed')
        }

        // Poll messages periodically for activity logging + intermediate token tracking.
        // Uses a tick counter to avoid fetching messages on every 1s status poll.
        active.pollTick += 1
        if (active.pollTick % ACTIVITY_POLL_EVERY_N_TICKS === 0) {
          await this.pollActivity(active)
        }

        await waitForNextPoll(active, COMPLETION_POLL_INTERVAL_MS)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('opencode', `${tag} waitForCompletion error: ${msg}`)
      return await this.finish(
        active,
        active.killRequested
          ? (active.killReason === 'completed' ? 'completed' : 'killed')
          : 'crashed',
      )
    } finally {
      active.completed = true
      this.stopHeartbeat(active)
      this.sessions.delete(active.sessionId)
      await disconnectMcpServer(this.openCodeUrl, active.directory, active.mcpServerName).catch(() => undefined)
    }
  }

  private async finish(
    active: ActiveSession,
    exitReason: HarnessSessionResult['exitReason'],
  ): Promise<HarnessSessionResult> {
    const messages = await listSessionMessages(this.openCodeUrl, active.directory, active.sessionId).catch(() => [])

    // Final activity pass — process any messages not yet seen
    processNewMessages(this.apiUrl, active.runId, messages, active.activityCursor, active.controlToken)

    // Post completion activity entry (matches Claude adapter's 'result' format)
    postCompletionActivity(this.apiUrl, active.runId, exitReason, active.activityCursor)

    const usage = summarizeOpenCodeUsage(messages, exitReason)

    // Post only the remaining token delta (cursor already posted intermediate deltas)
    if (!active.usagePosted) {
      const remainingDelta = {
        tokensIn: Math.max(0, usage.tokensIn - active.activityCursor.tokensIn),
        tokensOut: Math.max(0, usage.tokensOut - active.activityCursor.tokensOut),
        costUsd: roundUsd(Math.max(0, usage.costUsd - active.activityCursor.costUsd)),
      }
      active.usagePosted = true
      if (remainingDelta.tokensIn > 0 || remainingDelta.tokensOut > 0 || remainingDelta.costUsd > 0) {
        await emitHarnessEvent(this.apiUrl, active.runId, { type: 'cost.updated', usage: remainingDelta }, active.controlToken).catch(() => undefined)
      }
    }

    return usage
  }

  private async pollActivity(active: ActiveSession): Promise<void> {
    const messages = await listSessionMessages(this.openCodeUrl, active.directory, active.sessionId).catch(() => [])
    if (messages.length > active.activityCursor.nextIndex) {
      processNewMessages(this.apiUrl, active.runId, messages, active.activityCursor, active.controlToken)
    }
  }

  private async tickHeartbeat(active: ActiveSession): Promise<void> {
    // Always send heartbeat first — keeps the run alive in Ductum
    // even if isAlive check fails due to transient errors
    await emitHarnessEvent(this.apiUrl, active.runId, { type: 'heartbeat' }).catch(() => undefined)

    const alive = await this.isAlive(active.sessionId).catch((err) => {
      log.warn('opencode', `[opencode:${active.sessionId.slice(0, 12)}] isAlive error (keeping heartbeat): ${err instanceof Error ? err.message : String(err)}`)
      return true // Assume alive on error — let the completion loop handle real failures
    })
    if (!alive && active.completed) {
      this.stopHeartbeat(active)
    }
  }

  private async getStatus(active: ActiveSession) {
    const statuses = await getSessionStatuses(this.openCodeUrl, active.directory)
    return statuses[active.sessionId] ?? null
  }

  private buildToolPermissions(active: ActiveSession): Record<string, boolean> {
    const permissions: Record<string, boolean> = {}

    for (const sibling of this.sessions.values()) {
      if (sibling.directory !== active.directory) {
        continue
      }

      const value = sibling.sessionId === active.sessionId
      for (const toolId of buildDuctumMcpToolIds(sibling.mcpServerName)) {
        permissions[toolId] = value
      }
    }

    return permissions
  }

  private stopHeartbeat(active: ActiveSession): void {
    if (active.heartbeat != null) {
      clearInterval(active.heartbeat)
      active.heartbeat = null
    }
  }
}

function resolveDuctumMcpCommand(agent: Agent): string[] {
  const configured = agent.spawnConfig.env?.DUCTUM_MCP_COMMAND_JSON
  if (configured != null) {
    return JSON.parse(configured) as string[]
  }

  return [process.execPath, fileURLToPath(new URL('../../mcp/dist/index.js', import.meta.url))]
}

function buildMcpEnvironment(
  apiUrl: string,
  runId: RunId,
  agent: Agent,
  controlToken?: string,
): Record<string, string> {
  const env = {
    ...agent.spawnConfig.env,
    DUCTUM_API_URL: apiUrl,
    DUCTUM_RUN_ID: runId,
    DUCTUM_CONTROL_TOKEN: controlToken,
  }
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] != null))
}

async function waitForNextPoll(active: ActiveSession, ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      active.wakeCompletionLoop = null
      resolve()
    }, ms)

    active.wakeCompletionLoop = () => {
      clearTimeout(timer)
      active.wakeCompletionLoop = null
      resolve()
    }
  })
}
