/**
 * GitHub Copilot SDK harness adapter.
 *
 * Dispatches tasks to the GitHub Copilot CLI (gpt-5 / gpt-5.4) via the
 * official @github/copilot-sdk package. Ported from codex-sdk.ts — the
 * Copilot SDK is shaped identically (stream-based events, MCP tool
 * registration, permission handlers) so this file is a near-1:1 port
 * with SDK-specific plumbing swapped.
 *
 * Auth: handled by gh CLI (`gh auth login`) or COPILOT_GITHUB_TOKEN /
 *   GH_TOKEN / GITHUB_TOKEN env vars. The SDK picks them up
 *   automatically.
 * Multi-turn: handled inside the Copilot CLI, same as codex-sdk.
 * Sandbox: the worktree provides filesystem isolation (dedicated
 *   branch + directory). The SDK's permission handler is wired to
 *   `approveAll` because Edictum's workflow guards run at the MCP
 *   boundary — only tools we register can be called, and those are
 *   already gated by Ductum's workflow runtime.
 * Enforcement: Ductum MCP tools reach the agent via Copilot's native
 *   `mcpServers` config, pointing at the per-run HTTP MCP server at
 *   ${apiUrl}/api/mcp/${run.id}. Same surface as codex-sdk — no
 *   custom Tool[] shim needed (path B in the handover).
 */

import {
  CopilotClient,
  type CopilotSession,
  approveAll,
} from '@github/copilot-sdk'

import type { AgentId, DispatcherMcpServer, Run, RunId, SpawnOptions, Task } from '@ductum/core'
import { log } from '@ductum/core'

import { emitHarnessEvent } from './canonical-events.js'
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
 * Default model when the agent record doesn't pin one. The Copilot CLI
 * README uses `gpt-5` as its documented example; operators can override
 * per-agent via the Agent record's model field in Factory Settings.
 */
const DEFAULT_COPILOT_MODEL = 'gpt-5'

interface ActiveSession {
  runId: RunId
  sessionId: string
  controlToken: string | null
  client: CopilotClient
  session: CopilotSession | null
  killRequested: boolean
  /** See HarnessAdapter.kill — 'completed' means ductum.complete drove
   *  the teardown so the exitReason should stay 'completed'. */
  killReason: 'killed' | 'completed'
  completed: boolean
  heartbeatTimer: NodeJS.Timeout | null
  tokensIn: number
  tokensOut: number
  completion: Promise<HarnessSessionResult>
  resolveCompletion: ((r: HarnessSessionResult) => void) | null
  /**
   * Unsubscribe callbacks returned by `session.on(...)`. Flushed in
   * cleanup() so the SDK doesn't keep references to ActiveSession after
   * the run ends.
   */
  unsubscribes: Array<() => void>
  /**
   * Deferred that resolves when the session emits `session.idle` (or
   * `session.error`). The runTurn loop awaits this — we can't rely on
   * an async iterator for Copilot events, so we pump completion off
   * the event-handler path instead.
   */
  completionSignal: Promise<HarnessSessionResult['exitReason']>
  resolveCompletionSignal: ((reason: HarnessSessionResult['exitReason']) => void) | null
  harnessSessionIdReported: boolean
}

export class CopilotSDKHarnessAdapter implements HarnessAdapter {
  private readonly apiUrl: string
  private readonly sessions = new Map<string, ActiveSession>()

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl
  }

  async spawn(
    run: Run,
    task: Task,
    systemPrompt: string,
    _mcpServer: DispatcherMcpServer,
    options?: SpawnOptions,
  ): Promise<HarnessSession> {
    const workingDir = options?.workingDir ?? process.cwd()
    const sessionId = `copilot-sdk-${run.id}-${Date.now()}`

    let resolveCompletion: (r: HarnessSessionResult) => void
    const completion = new Promise<HarnessSessionResult>((resolve) => {
      resolveCompletion = resolve
    })

    let resolveCompletionSignal: (reason: HarnessSessionResult['exitReason']) => void
    const completionSignal = new Promise<HarnessSessionResult['exitReason']>((resolve) => {
      resolveCompletionSignal = resolve
    })

    // Per-spawn HTTP MCP server name. Matches the codex-sdk pattern:
    // the run id is bound at the URL (/api/mcp/<runId>) so the MCP
    // surface never sees run_id as an argument — decision D22.
    //
    // We use a unique per-spawn name (`ductum_run_<short>`) because the
    // user may already have a global `ductum` MCP server registered in
    // gh copilot's config, and mixing types under the same key can
    // confuse the CLI. A namespaced entry dodges the collision.
    const mcpServerName = `ductum_run_${run.id.slice(0, 6)}`
    const mcpUrl = withControlToken(withOperatorToken(`${this.apiUrl}/api/mcp/${run.id}`), options?.controlToken)

    // The @github/copilot-sdk CopilotClient constructor kicks off the
    // stdio link to the Copilot CLI child process. `cwd` propagates to
    // the spawned CLI and is also used as the default `workingDirectory`
    // for sessions — matching codex-sdk's startThread({ workingDirectory }).
    const client = new CopilotClient({
      cwd: workingDir,
      // Auth: SDK picks up gh-auth / COPILOT_GITHUB_TOKEN / GH_TOKEN
      // automatically. Operators who need to pin a token can set the
      // env var explicitly — no need to plumb a setting through here.
    })
    await client.start()

    const active: ActiveSession = {
      runId: run.id,
      sessionId,
      controlToken: options?.controlToken ?? null,
      client,
      session: null,
      killRequested: false,
      killReason: 'killed',
      completed: false,
      heartbeatTimer: null,
      tokensIn: 0,
      tokensOut: 0,
      completion,
      resolveCompletion: resolveCompletion!,
      unsubscribes: [],
      completionSignal,
      resolveCompletionSignal: resolveCompletionSignal!,
      harnessSessionIdReported: false,
    }

    this.sessions.set(sessionId, active)

    active.heartbeatTimer = setInterval(() => {
      void emitHarnessEvent(this.apiUrl, run.id, { type: 'heartbeat' }).catch(() => undefined)
    }, HEARTBEAT_INTERVAL_MS)

    // Resolve the agent's configured model. The Agent record may pin
    // one via Factory Settings; otherwise fall back to gpt-5 (the
    // README's documented example).
    const model = await this.resolveAgentModel(run.agentId)

    try {
      const session = await client.createSession({
        model,
        streaming: true,
        workingDirectory: workingDir,
        onPermissionRequest: approveAll,
        // Copilot's native mcpServers config — no custom Tool[] shim
        // needed. The HTTP MCP route at /api/mcp/<runId> already
        // exposes every Ductum tool (workflow, update, complete, ...)
        // and is pre-bound to the run id.
        mcpServers: {
          [mcpServerName]: {
            type: 'http',
            url: mcpUrl,
            tools: ['*'],
          },
        },
      })
      active.session = session

      // Report the Copilot-assigned session id so the cost scanner can
      // look up the matching jsonl log on disk if Copilot writes one.
      // Best-effort — not every Copilot install emits scannable logs.
      if (!active.harnessSessionIdReported && session.sessionId !== '') {
        active.harnessSessionIdReported = true
        void emitHarnessEvent(this.apiUrl, run.id, { type: 'session.started', harnessSessionId: session.sessionId }).catch(() => undefined)
      }

      this.wireEventHandlers(active, run)
    } catch (error) {
      this.cleanup(active)
      await client.stop().catch(() => undefined)
      throw error
    }

    // Kick off the turn in the background — runTurn awaits the
    // completionSignal promise that the event handlers resolve when
    // session.idle / session.error fires.
    void this.runTurn(active, run, task, systemPrompt)

    return {
      sessionId,
      harnessSessionId: sessionId,
      runId: run.id,
      waitForCompletion: async () => await completion,
    }
  }

  async kill(sessionId: string, reason: 'killed' | 'completed' | 'cancelled' = 'killed'): Promise<void> {
    const active = this.sessions.get(sessionId)
    if (active == null) return
    active.killRequested = true
    active.killReason = reason === 'cancelled' ? 'killed' : reason

    // Stop the live session. disconnect() tells the CLI to tear down
    // its end; stop() terminates the child CopilotClient process. Both
    // are best-effort — if the CLI already exited the calls no-op.
    try {
      await active.session?.disconnect()
    } catch { /* ignore */ }

    // For reason='completed' leave the session in the sessions map so
    // the completion handler resolves naturally through session.idle
    // (or our own resolveCompletionSignal fallback below). Forced
    // kills tear down the map entry directly.
    if (reason === 'completed') {
      // Nudge runTurn to exit via the completionSignal path.
      active.resolveCompletionSignal?.('completed')
    } else {
      active.resolveCompletionSignal?.('killed')
      this.cleanup(active)
      try { await active.client.stop() } catch { /* ignore */ }
    }
  }

  async isAlive(sessionId: string): Promise<boolean> {
    const active = this.sessions.get(sessionId)
    return active != null && !active.completed && !active.killRequested
  }

  /**
   * Wire `session.on(...)` event handlers for activity streaming,
   * token accounting, and completion detection. Every handler is
   * best-effort — a failed postActivity call must not break the
   * agent's session.
   */
  private wireEventHandlers(active: ActiveSession, run: Run): void {
    if (active.session == null) return
    const session = active.session

    // Streaming text chunks — the final text lands via assistant.message
    // so we skip posting deltas to avoid flooding the activity feed.
    // Kept as a no-op subscription in case operators want to add
    // granular streaming later.
    active.unsubscribes.push(
      session.on('assistant.message_delta', () => {
        // intentionally empty — see assistant.message for the full text
      }),
    )

    active.unsubscribes.push(
      session.on('assistant.message', (event) => {
        const content = event.data.content ?? ''
        if (content !== '') {
          void emitHarnessEvent(this.apiUrl, run.id, { type: 'text.delta', content }, active.controlToken).catch(() => undefined)
        }
      }),
    )

    active.unsubscribes.push(
      session.on('tool.execution_start', (event) => {
        const data = event.data
        const toolName = data.mcpToolName ?? data.toolName
        const args = data.arguments != null && typeof data.arguments === 'object'
          ? data.arguments as Record<string, unknown>
          : {}
        void emitHarnessEvent(this.apiUrl, run.id, {
          type: 'tool.requested',
          toolName,
          args,
          content: data.arguments != null ? JSON.stringify(data.arguments) : '',
        }, active.controlToken).catch(() => undefined)
      }),
    )

    active.unsubscribes.push(
      session.on('tool.execution_complete', (event) => {
        const data = event.data
        const result = data.result
        const content = result?.detailedContent ?? result?.content ?? ''
        const pending = this.pendingToolArgs.get(data.toolCallId)
        this.pendingToolArgs.delete(data.toolCallId)
        void emitHarnessEvent(this.apiUrl, run.id, {
          type: 'tool.result',
          toolName: pending?.toolName,
          args: pending?.args,
          content,
          success: data.success,
        }, active.controlToken).catch(() => undefined)
      }),
    )

    // Real token accounting lives on assistant.usage — session.usage_info
    // is CONTEXT-WINDOW stats, not billing. Each turn emits a fresh
    // assistant.usage event with per-turn token counts.
    active.unsubscribes.push(
      session.on('assistant.usage', (event) => {
        const data = event.data
        const inputTokens = data.inputTokens ?? 0
        const outputTokens = data.outputTokens ?? 0
        const cacheRead = data.cacheReadTokens ?? 0
        if (inputTokens > 0 || outputTokens > 0) {
          active.tokensIn += inputTokens
          active.tokensOut += outputTokens
          void emitHarnessEvent(this.apiUrl, run.id, {
            type: 'cost.updated',
            usage: {
              tokensIn: inputTokens,
              tokensOut: outputTokens,
              costUsd: 0,
              cachedTokensIn: cacheRead,
            },
          }, active.controlToken).catch(() => undefined)
        }
      }),
    )

    active.unsubscribes.push(
      session.on('session.idle', () => {
        active.resolveCompletionSignal?.('completed')
      }),
    )

    active.unsubscribes.push(
      session.on('session.error', (event) => {
        log.error(
          'copilot-sdk',
          `[${active.sessionId.slice(0, 16)}] session error: ${event.data.message}`,
        )
        active.resolveCompletionSignal?.('crashed')
      }),
    )

    // tool.execution_complete only carries toolCallId + success, so we
    // stash the start payload in a shadow map keyed by toolCallId and
    // replay it on completion for canonical tool.result emission.
    active.unsubscribes.push(
      session.on('tool.execution_start', (event) => {
        const data = event.data
        const toolName = data.mcpToolName ?? data.toolName
        const args =
          data.arguments != null && typeof data.arguments === 'object'
            ? (data.arguments as Record<string, unknown>)
            : {}
        this.pendingToolArgs.set(data.toolCallId, { toolName, args })
      }),
    )
  }

  /** Shadow map: toolCallId → { toolName, args }, populated on
   *  execution_start and consumed on execution_complete so the
   *  workflow evidence post has both the tool name and the args even
   *  though execution_complete only carries toolCallId. */
  private readonly pendingToolArgs = new Map<string, { toolName: string; args: Record<string, unknown> }>()

  private async runTurn(
    active: ActiveSession,
    run: Run,
    task: Task,
    systemPrompt: string,
  ): Promise<void> {
    const tag = `[copilot-sdk:${active.sessionId.slice(0, 16)}]`

    try {
      if (active.session == null) {
        throw new Error('copilot session was not created before runTurn')
      }
      log.info('copilot-sdk', `${tag} starting turn`)

      // Same workflow hint path codex-sdk uses — fetch the current
      // stage + required reads so the agent can plan the first turn
      // without a round-trip to the MCP tool.
      let workflowHint = ''
      try {
        const res = await fetch(`${this.apiUrl}/api/runs/${encodeURIComponent(run.id)}/workflow`, {
          headers: operatorTokenHeader(),
        })
        if (res.ok) {
          const info = await res.json() as {
            activeStage: string
            stages: Array<{ id: string; tools: string[]; exit: Array<{ condition: string; message?: string }> }>
          }
          const currentStage = info.stages.find((s) => s.id === info.activeStage)
          const stageList = info.stages.map((s) => s.id).join(' → ')
          const requiredReads = currentStage?.exit
            ?.filter((e) => e.condition.startsWith('file_read'))
            ?.map((e) => e.condition.match(/file_read\("([^"]+)"\)/)?.[1])
            ?.filter(Boolean) ?? []

          const mcpName = `ductum_run_${run.id.slice(0, 6)}`
          workflowHint = [
            '\n\n## Workflow Rules (enforced)',
            `Stages: ${stageList}`,
            `Current stage: ${info.activeStage}`,
            currentStage ? `Allowed tools: ${currentStage.tools.join(', ')}` : '',
            requiredReads.length > 0
              ? `\nIMPORTANT: You MUST read these files first to advance: ${requiredReads.join(', ')}`
              : '',
            '\n## Ductum MCP Tools',
            `These MCP tools live on the "${mcpName}" MCP server (HTTP transport, pre-bound to your run id). Call them with NO run_id argument:`,
            `- ${mcpName}.ductum_workflow() — get current workflow state`,
            `- ${mcpName}.ductum_update(message="...") — report progress`,
            `- ${mcpName}.ductum_complete(result="...") — signal implementation done (summary must be >= 50 chars)`,
          ].filter(Boolean).join('\n')
        }
      } catch { /* best-effort workflow hint */ }

      const prompt = `${systemPrompt}${workflowHint}\n\n${task.prompt}`
      await active.session.send({ prompt })

      // Block until session.idle / session.error fires. Event handlers
      // wired in wireEventHandlers() resolve active.completionSignal.
      const exitReason = await active.completionSignal

      log.info(
        'copilot-sdk',
        `${tag} turn ended (${exitReason}) — ${active.tokensIn}/${active.tokensOut} tokens`,
      )
      void emitHarnessEvent(this.apiUrl, run.id, { type: 'completed' }).catch(() => undefined)

      active.completed = true
      // If the turn exited because ductum.complete called kill(reason='completed'),
      // keep exitReason='completed' so the dispatcher's post-completion
      // pipeline runs (verify → review → ship). Otherwise pass through
      // whatever the event handlers reported.
      const finalReason: HarnessSessionResult['exitReason'] =
        active.killRequested && active.killReason === 'completed'
          ? 'completed'
          : exitReason
      active.resolveCompletion?.({
        exitReason: finalReason,
        tokensIn: active.tokensIn,
        tokensOut: active.tokensOut,
        costUsd: 0,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('copilot-sdk', `${tag} error: ${msg}`)
      active.completed = true
      const exitReason: HarnessSessionResult['exitReason'] = active.killRequested
        ? (active.killReason === 'completed' ? 'completed' : 'killed')
        : 'crashed'
      active.resolveCompletion?.({
        exitReason,
        tokensIn: active.tokensIn,
        tokensOut: active.tokensOut,
        costUsd: 0,
      })
    } finally {
      this.cleanup(active)
      // Make a best-effort attempt to stop the CLI process. For a
      // completed session we've already disconnected via kill(); this
      // just tears down the client-side link.
      try {
        await active.client.stop()
      } catch { /* ignore */ }
    }
  }

  /**
   * Resolve the model pinned on the agent record. Falls back to
   * DEFAULT_COPILOT_MODEL if the fetch fails or the agent doesn't
   * specify one — the Copilot CLI rejects sessions with an empty
   * model field.
   */
  private async resolveAgentModel(agentId: AgentId): Promise<string> {
    try {
      const res = await fetch(`${this.apiUrl}/api/agents/${encodeURIComponent(agentId)}`, {
        headers: operatorTokenHeader(),
      })
      if (!res.ok) return DEFAULT_COPILOT_MODEL
      const agent = await res.json() as { model?: string | null }
      if (typeof agent.model === 'string' && agent.model !== '') return agent.model
    } catch { /* ignore */ }
    return DEFAULT_COPILOT_MODEL
  }

  private cleanup(active: ActiveSession): void {
    if (active.heartbeatTimer != null) {
      clearInterval(active.heartbeatTimer)
      active.heartbeatTimer = null
    }
    for (const unsub of active.unsubscribes) {
      try { unsub() } catch { /* ignore */ }
    }
    active.unsubscribes.length = 0
    this.sessions.delete(active.sessionId)
  }
}

function withOperatorToken(url: string): string {
  const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
  if (token == null || token === '' || isPlaceholderToken(token)) return url
  const parsed = new URL(url)
  parsed.searchParams.set('ductum_operator_token', token)
  return parsed.toString()
}

function withControlToken(url: string, controlToken: string | undefined): string {
  const token = controlToken?.trim()
  if (token == null || token === '') return url
  const parsed = new URL(url)
  parsed.searchParams.set('ductum_control_token', token)
  return parsed.toString()
}

function operatorTokenHeader(): Record<string, string> | undefined {
  const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
  return token == null || token === '' || isPlaceholderToken(token) ? undefined : { 'x-ductum-operator-token': token }
}

function isPlaceholderToken(token: string): boolean {
  return ['missing', 'changeme', 'replace-me'].includes(token.toLowerCase())
}
