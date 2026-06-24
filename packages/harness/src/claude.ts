import type { Agent, DispatcherMcpServer, Run, RunId, SpawnOptions, Task } from '@ductum/core'
import { log } from '@ductum/core'

import { emitHarnessEvent } from './canonical-events.js'
import { createPostToolUseHook, createPreToolUseHook } from './claude-hooks.js'
import { fetchAgent } from './rest.js'
import { CLAUDE_BYPASS_PERMISSION_MODE, type ClaudeQuery, type ClaudeQueryMessage, type ClaudeQueryOptions, type ClaudeResultMessage, buildClaudeMcpServers, startClaudeQuery } from './sdk.js'
import { asKillTarget, spawnHostExternalCliProcess, terminateProcessTree, type HostProcessLaunch } from './process-tree-cleanup.js'
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

/**
 * Default agent-turn budget per Claude Agent SDK session. Decision 118:
 * a paused-on-max-turns run is gate-evaluated, not auto-killed; the
 * effective cap for a run is BASE_MAX_TURNS + task.turnExtraCount.
 */
const BASE_MAX_TURNS = 200

/**
 * Resolve the SDK's internal `maxBudgetUsd` cap from the same source
 * the API reads at startup (DUCTUM_COST_BUDGET env var). Aligns the
 * SDK's safety net with ductum's primary `perRunHardUsd`. Returns
 * undefined if no global cap is configured. Decision 114 + 118:
 * `error_max_budget_usd` becomes a gate that maps to
 * `cost_budget_paused`, the same path as ductum's preemptive enforce.
 */
function resolveSdkBudgetUsd(): number | undefined {
  const raw = process.env.DUCTUM_COST_BUDGET
  if (raw == null) return undefined
  try {
    const parsed = JSON.parse(raw) as { perRunHardUsd?: number }
    return typeof parsed.perRunHardUsd === 'number' ? parsed.perRunHardUsd : undefined
  } catch {
    return undefined
  }
}

interface UsageCursor {
  tokensIn: number
  tokensOut: number
  costUsd: number
}

interface ActiveSession {
  sessionId: string | null
  controlToken: string | null
  runId: RunId
  query: ClaudeQuery
  claudeProcess: HostProcessLaunch | null
  heartbeat: NodeJS.Timeout
  completion: Promise<HarnessSessionResult>
  killRequested: boolean
  /**
   * Reason kill() was called. 'completed' signals that ductum.complete
   * fired and the dispatcher is driving a clean teardown — the
   * completion result should map to exitReason='completed' so
   * handleSessionEnd runs the post-completion pipeline. 'killed' is
   * the legacy forced-kill semantics.
   */
  killReason: 'killed' | 'completed'
  completed: boolean
  usage: UsageCursor
  /** Effective maxTurns this session was launched with. D118. */
  effectiveMaxTurns: number
  /** SDK-side maxBudgetUsd cap, when set. D114/D118. */
  sdkBudgetUsd?: number
  workerStartedAt: string | null
  lastActivityText: string | null
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

export class ClaudeHarnessAdapter implements HarnessAdapter {
  private readonly sessions = new Map<string, ActiveSession>()

  constructor(private readonly apiUrl: string) {}

  async spawn(run: Run, task: Task, systemPrompt: string, mcpServer: DispatcherMcpServer, options?: SpawnOptions): Promise<HarnessSession> {
    const agent = options?.agent ?? await fetchAgent(this.apiUrl, run.agentId)
    const controlToken = options?.controlToken ?? null
    const heartbeat = setInterval(() => {
      void emitHarnessEvent(this.apiUrl, run.id, { type: 'heartbeat' }, controlToken).catch(() => undefined)
    }, HEARTBEAT_INTERVAL_MS)
    const sessionReady = createDeferred<string>()

    const effectiveMaxTurns = BASE_MAX_TURNS + (task.turnExtraCount ?? 0)
    const sdkBudgetUsd = resolveSdkBudgetUsd()
    const active: ActiveSession = {
      sessionId: null,
      controlToken,
      runId: run.id,
      query: null as unknown as ClaudeQuery,
      claudeProcess: null,
      heartbeat,
      completion: Promise.resolve<HarnessSessionResult>({
        exitReason: 'crashed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      }),
      killRequested: false,
      killReason: 'killed',
      completed: false,
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      effectiveMaxTurns,
      sdkBudgetUsd,
      workerStartedAt: null,
      lastActivityText: null,
    }

    active.query = startClaudeQuery(
      task.prompt,
      this.buildQueryOptions(
        agent,
        systemPrompt,
        mcpServer,
        active,
        options?.workingDir,
        task.turnExtraCount ?? 0,
        sdkBudgetUsd,
        options?.env,
      ),
    )

    active.completion = this.pumpSession(active, sessionReady)

    let sessionId: string
    try {
      sessionId = await Promise.race([
        sessionReady.promise,
        active.completion.then(() => {
          throw new Error('Claude session ended before yielding a session ID')
        }),
      ])
    } catch (error) {
      this.cleanup(active)
      active.query.close()
      if (active.claudeProcess != null) {
        await terminateProcessTree(asKillTarget(active.claudeProcess.child), active.claudeProcess.ownership).catch(() => undefined)
      }
      throw error
    }

    this.sessions.set(sessionId, active)

    return {
      sessionId,
      harnessSessionId: sessionId,
      workerPid: active.claudeProcess?.ownership.pid ?? null,
      workerOwnershipKind: active.claudeProcess?.ownership.kind ?? null,
      workerStartedAt: active.workerStartedAt,
      workerOwnershipUnsupportedReason: active.claudeProcess?.ownership.unsupportedReason ?? null,
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
    this.cleanup(active)
    active.query.close()
    if (active.claudeProcess != null) {
      await terminateProcessTree(asKillTarget(active.claudeProcess.child), active.claudeProcess.ownership).catch(() => undefined)
    }
    await active.completion.catch(() => undefined)
  }

  async isAlive(sessionId: string): Promise<boolean> {
    const active = this.sessions.get(sessionId)
    return active != null && !active.completed && !active.killRequested
  }

  private buildQueryOptions(
    agent: Agent,
    systemPrompt: string,
    mcpServer: DispatcherMcpServer,
    active: Pick<ActiveSession, 'runId' | 'sessionId' | 'controlToken' | 'claudeProcess' | 'workerStartedAt'>,
    workingDir?: string,
    turnExtraCount: number = 0,
    sdkBudgetUsd?: number,
    providedEnv?: Record<string, string>,
  ): ClaudeQueryOptions {
    // Scoped env from the dispatcher's secret broker when wired; legacy full-host fallback otherwise.
    const env = {
      ...(providedEnv ?? { ...process.env, ...agent.spawnConfig.env }),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'ductum/0.1.0',
    }
    const effort = normalizeClaudeEffort(agent.effort)

    return {
      cwd: workingDir ?? agent.spawnConfig.workingDir ?? process.cwd(),
      env,
      hooks: {
        PreToolUse: [{ hooks: [createPreToolUseHook(this.apiUrl, active)] }],
        PostToolUse: [{ hooks: [createPostToolUseHook(this.apiUrl, active)] }],
      },
      mcpServers: buildClaudeMcpServers('ductum', mcpServer),
      model: agent.model,
      ...(effort != null ? { effort: effort as ClaudeQueryOptions['effort'] } : {}),
      systemPrompt,
      permissionMode: CLAUDE_BYPASS_PERMISSION_MODE,
      allowDangerouslySkipPermissions: true,
      spawnClaudeCodeProcess: (spawnOptions) => {
        const launched = spawnHostExternalCliProcess(spawnOptions.command, spawnOptions.args, {
          cwd: spawnOptions.cwd,
          env: spawnOptions.env,
        })
        active.claudeProcess = launched
        active.workerStartedAt = new Date().toISOString()
        spawnOptions.signal.addEventListener('abort', () => {
          void terminateProcessTree(asKillTarget(launched.child), launched.ownership).catch(() => undefined)
        }, { once: true })
        return launched.child
      },
      maxTurns: BASE_MAX_TURNS + turnExtraCount,
      ...(sdkBudgetUsd != null ? { maxBudgetUsd: sdkBudgetUsd } : {}),
    }
  }

  private async pumpSession(active: ActiveSession, sessionReady: Deferred<string>): Promise<HarnessSessionResult> {
    let finalResult: ClaudeResultMessage | null = null

    try {
      for await (const message of active.query) {
        const sessionId = getSessionId(message)
        if (sessionId != null && active.sessionId == null) {
          active.sessionId = sessionId
          void emitHarnessEvent(this.apiUrl, active.runId, { type: 'session.started', harnessSessionId: sessionId }).catch(() => undefined)
          sessionReady.resolve(sessionId)
        }

        logAgentMessage(this.apiUrl, active.runId, message, active.controlToken)
        const activityText = extractActivityText(message)
        if (activityText != null) active.lastActivityText = activityText

        // Track token usage from intermediate assistant messages so the
        // dashboard shows progress during a run, not only at session end.
        // Assistant messages carry per-turn usage (not cumulative), so
        // each one is posted as a delta and accumulated into active.usage.
        if (message.type === 'assistant' && message.message?.usage) {
          const usage = message.message.usage as {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          // Anthropic's input_tokens counts ONLY the uncached portion;
          // the cached read + cache creation counts are separate fields.
          // The /tokens route expects tokensIn to be GROSS (= uncached +
          // cache_read + cache_creation) so cache-aware pricing has the
          // full picture to work with.
          const uncached = usage.input_tokens ?? 0
          const cacheRead = usage.cache_read_input_tokens ?? 0
          const cacheCreate = usage.cache_creation_input_tokens ?? 0
          const delta = {
            tokensIn: uncached + cacheRead + cacheCreate,
            tokensOut: usage.output_tokens ?? 0,
            costUsd: 0, // per-message cost not available from SDK
            cachedTokensIn: cacheRead,
            cacheCreationTokensIn: cacheCreate,
          }
          if (delta.tokensIn > 0 || delta.tokensOut > 0) {
            active.usage.tokensIn += delta.tokensIn
            active.usage.tokensOut += delta.tokensOut
            void emitHarnessEvent(this.apiUrl, active.runId, { type: 'cost.updated', usage: delta }, active.controlToken).catch(() => undefined)
          }
        }

        if (message.type === 'result') {
          finalResult = message
          await this.recordUsage(active, message)
        }
      }

      return this.buildResult(active, finalResult)
    } catch (error) {
      const msg = error instanceof Error ? error.stack ?? error.message : String(error)
      log.error('claude-harness', `session ${active.sessionId ?? '(no id)'} error: ${msg}`)
      sessionReady.reject(error)
      if (active.killRequested) {
        return this.snapshot(active, active.killReason === 'completed' ? 'completed' : 'killed')
      }
      return this.snapshot(active, 'crashed')
    } finally {
      active.completed = true
      this.cleanup(active)
      if (active.sessionId != null) {
        this.sessions.delete(active.sessionId)
      }
    }
  }

  private async recordUsage(active: ActiveSession, message: ClaudeResultMessage): Promise<void> {
    // Anthropic's result.usage has input_tokens (uncached only), plus
    // cache_read_input_tokens and cache_creation_input_tokens as
    // separate fields. We accumulate GROSS (sum of all three) into
    // active.usage.tokensIn so the per-message path and result path
    // agree, otherwise the delta arithmetic below undercounts.
    const resultUsage = message.usage as {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    const uncached = resultUsage.input_tokens
    const cacheRead = resultUsage.cache_read_input_tokens ?? 0
    const cacheCreate = resultUsage.cache_creation_input_tokens ?? 0
    const totals = {
      tokensIn: uncached + cacheRead + cacheCreate,
      tokensOut: resultUsage.output_tokens,
      costUsd: message.total_cost_usd,
    }
    const delta = {
      tokensIn: Math.max(0, totals.tokensIn - active.usage.tokensIn),
      tokensOut: Math.max(0, totals.tokensOut - active.usage.tokensOut),
      costUsd: roundUsd(Math.max(0, totals.costUsd - active.usage.costUsd)),
    }

    active.usage = {
      tokensIn: Math.max(active.usage.tokensIn, totals.tokensIn),
      tokensOut: Math.max(active.usage.tokensOut, totals.tokensOut),
      costUsd: Math.max(active.usage.costUsd, totals.costUsd),
    }

    if (delta.tokensIn === 0 && delta.tokensOut === 0 && delta.costUsd === 0) {
      return
    }

    await emitHarnessEvent(this.apiUrl, active.runId, { type: 'cost.updated', usage: delta }, active.controlToken).catch(() => undefined)
  }

  private buildResult(active: ActiveSession, result: ClaudeResultMessage | null): HarnessSessionResult {
    if (result == null) {
      if (active.killRequested) {
        return this.snapshot(active, active.killReason === 'completed' ? 'completed' : 'killed')
      }
      return this.snapshot(active, 'crashed')
    }
    if (active.killRequested) {
      return this.snapshot(active, active.killReason === 'completed' ? 'completed' : 'killed')
    }
    if (result.subtype === 'error_max_turns') {
      // Decision 118: max_turns is gate-evaluated. Worktree, tokens,
      // and partial work are preserved; the operator extends turns to
      // resume or denies to terminate honestly.
      return this.snapshot(active, 'paused-max-turns', {
        detail: `hit ${active.effectiveMaxTurns} of ${active.effectiveMaxTurns} agent turns`,
        cap: active.effectiveMaxTurns,
      })
    }
    if (result.subtype === 'error_max_budget_usd') {
      // Decision 114: error_max_budget_usd is the SDK's internal
      // safety net for the same per-run cost cap ductum's
      // enforceCostBudget polices. Map to the same gate so operators
      // see one budget surface, not two. ductum's enforce normally
      // trips first; this path catches the case where it didn't.
      const cap = active.sdkBudgetUsd ?? active.usage.costUsd
      return this.snapshot(active, 'paused-cost-budget', {
        detail: `SDK reported cost cap reached at \$${active.usage.costUsd.toFixed(2)} (cap \$${cap.toFixed(2)})`,
        cap,
      })
    }
    const maxTurnsReached = classifySilentMaxTurnsReached(result, active.lastActivityText, active.effectiveMaxTurns)
    if (maxTurnsReached != null) {
      return this.snapshot(active, 'failed', undefined, maxTurnsReached)
    }
    const promptOverflow = classifyPromptOverflow(result, active.lastActivityText)
    if (promptOverflow != null) {
      return this.snapshot(active, 'failed', undefined, promptOverflow)
    }
    if (!result.is_error && result.terminal_reason === 'completed') {
      return this.snapshot(active, 'completed')
    }
    return this.snapshot(active, 'crashed')
  }

  private snapshot(
    active: ActiveSession,
    exitReason: HarnessSessionResult['exitReason'],
    pauseDetail?: HarnessSessionResult['pauseDetail'],
    failure?: Pick<HarnessSessionResult, 'failReason' | 'failureEvidence'>,
  ): HarnessSessionResult {
    return {
      exitReason,
      tokensIn: active.usage.tokensIn,
      tokensOut: active.usage.tokensOut,
      costUsd: active.usage.costUsd,
      ...(failure?.failReason != null ? { failReason: failure.failReason } : {}),
      ...(failure?.failureEvidence != null ? { failureEvidence: failure.failureEvidence } : {}),
      ...(pauseDetail != null ? { pauseDetail } : {}),
    }
  }

  private cleanup(active: ActiveSession): void {
    clearInterval(active.heartbeat)
  }
}

function normalizeClaudeEffort(effort: Agent['effort']): Agent['effort'] {
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max') {
    return effort
  }
  return undefined
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function getSessionId(message: ClaudeQueryMessage): string | null {
  if ('session_id' in message && typeof message.session_id === 'string') {
    return message.session_id
  }
  return null
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

const PROMPT_OVERFLOW_SIGNATURE = /prompt is too long|prompt[^.]{0,80}too long|context[^.]{0,80}(overflow|too long|exceed)|maximum context|too many tokens/i
const MAX_TURNS_REACHED_SIGNATURE = /max(?:imum)?[_ -]?turns?|turn budget|turns?[^.]{0,80}(exhausted|reached|limit)|reached[^.]{0,80}turn/i

function classifySilentMaxTurnsReached(
  result: ClaudeResultMessage,
  lastActivityText: string | null,
  currentLimit: number,
): Pick<HarnessSessionResult, 'failReason' | 'failureEvidence'> | null {
  const resultText = 'result' in result && typeof result.result === 'string' ? result.result.trim() : null
  const activity = lastActivityText?.trim() ?? ''
  const match = activity.match(MAX_TURNS_REACHED_SIGNATURE)
  if (
    result.subtype !== 'success' ||
    result.is_error ||
    resultText !== '' ||
    match == null
  ) return null
  const suggestedLimit = suggestMaxTurnsLimit(currentLimit)
  return {
    failReason: 'max_turns_reached',
    failureEvidence: {
      kind: 'claude-agent-sdk.max_turns_reached',
      reason: 'max_turns_reached',
      signature: match[0],
      lastActivity: activity.slice(0, 1000),
      resultTextEmpty: true,
      currentLimit,
      suggestedLimit,
      suggestedActions: [
        {
          kind: 'bump_max_turns',
          description: `Retry with a ${suggestedLimit}-turn cap.`,
          args: { currentLimit, suggestedLimit },
        },
        {
          kind: 'retry_same_agent',
          description: 'Retry the same agent after preserving the partial worktree.',
          args: {},
        },
        {
          kind: 'switch_agent',
          description: 'Retry with another eligible agent.',
          args: { candidateAgents: [] },
        },
      ],
    },
  }
}

function classifyPromptOverflow(
  result: ClaudeResultMessage,
  lastActivityText: string | null,
): Pick<HarnessSessionResult, 'failReason' | 'failureEvidence'> | null {
  const resultText = 'result' in result && typeof result.result === 'string' ? result.result.trim() : null
  const activity = lastActivityText?.trim() ?? ''
  const match = activity.match(PROMPT_OVERFLOW_SIGNATURE)
  if (
    result.subtype !== 'success' ||
    result.is_error ||
    resultText !== '' ||
    match == null
  ) return null
  return {
    failReason: 'prompt_overflow',
    failureEvidence: {
      kind: 'claude-agent-sdk.prompt_overflow',
      reason: 'prompt_overflow',
      signature: match[0],
      lastActivity: activity.slice(0, 1000),
      resultTextEmpty: true,
    },
  }
}

function suggestMaxTurnsLimit(currentLimit: number): number {
  return Math.max(currentLimit + 50, Math.ceil(currentLimit * 1.5))
}

function extractActivityText(message: ClaudeQueryMessage): string | null {
  if (message.type === 'assistant') {
    const content = message.message?.content
    if (!Array.isArray(content)) return null
    const parts: string[] = []
    for (const block of content) {
      const candidate = block as { type?: unknown; text?: unknown }
      if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
    }
    const text = parts.join('\n').trim()
    return text === '' ? null : text
  }
  if (message.type === 'tool_use_summary') return message.summary
  return null
}

/**
 * Content posted to run_activity used to be hard-capped at 120 /
 * 500 / 2000 chars depending on the kind — operators kept seeing
 * tool call args cut off mid-JSON. Replaced with a single dynamic
 * cap via `truncateActivity` (shared with the other harnesses), so
 * the limit is consistent and configurable via the
 * DUCTUM_ACTIVITY_MAX_BYTES env var.
 */
const LOG_PREVIEW_MAX = 200

function logAgentMessage(apiUrl: string, runId: RunId, message: ClaudeQueryMessage, controlToken?: string | null): void {
  const tag = `[agent:${runId}]`

  if (message.type === 'assistant') {
    const content = message.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          const preview = block.text.slice(0, LOG_PREVIEW_MAX).replace(/\n/g, ' ')
          log.info('agent', `${tag} text: ${preview}`)
          void emitHarnessEvent(apiUrl, runId, { type: 'text.delta', content: block.text }, controlToken).catch(() => undefined)
        }
        if (block.type === 'tool_use') {
          const fullArgs = JSON.stringify(block.input ?? {})
          const logPreview = fullArgs.slice(0, LOG_PREVIEW_MAX)
          log.info('agent', `${tag} tool: ${block.name}(${logPreview})`)
          void emitHarnessEvent(apiUrl, runId, {
            type: 'tool.requested',
            toolName: block.name,
            args: (block.input ?? {}) as Record<string, unknown>,
            content: fullArgs,
          }, controlToken).catch(() => undefined)
        }
      }
    }
  }

  // tool_use_summary contains the tool result text
  if (message.type === 'tool_use_summary') {
    const preview = message.summary.slice(0, LOG_PREVIEW_MAX).replace(/\n/g, ' ')
    log.info('agent', `${tag} summary: ${preview}`)
    void emitHarnessEvent(apiUrl, runId, { type: 'tool.result', content: message.summary }, controlToken).catch(() => undefined)
  }

  if (message.type === 'result') {
    const cost = 'total_cost_usd' in message ? `$${message.total_cost_usd}` : ''
    const msg = `session ended — ${message.subtype ?? 'unknown'} ${cost}`
    log.info('agent', `${tag} result: ${msg}`)
    void emitHarnessEvent(apiUrl, runId, { type: 'completed', content: msg }, controlToken).catch(() => undefined)
  }
}
