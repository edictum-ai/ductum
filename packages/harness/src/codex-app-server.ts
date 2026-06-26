import readline from 'node:readline'
import { formatUnknownError, log, resolveUsageCostTruth, type DispatcherMcpServer, Run, type RunId, type SpawnOptions, type Task } from '@ductum/core'
import { emitHarnessEvent } from './canonical-events.js'
import { handleNotification, handleServerRequest } from './codex-app-server-handlers.js'
import { completeDeadCodexAppServerSession } from './codex-app-server-dead-session.js'
import type { PendingCodexToolApproval } from './codex-app-server-events.js'
import { getCodexItemId } from './codex-app-server-events.js'
import {
  buildCodexAppServerEnv,
  buildCodexContainerMcpEnv,
  buildCodexMcpServerName,
  buildCodexMcpThreadConfig,
  buildCodexMcpToolHint,
} from './codex-mcp-config.js'
import { normalizeCodexEffort, normalizeCodexModel } from './codex-model.js'
import type { ActiveSession, JsonRpcMessage } from './codex-app-server-types.js'
import { HEARTBEAT_INTERVAL_MS } from './codex-app-server-types.js'
import { spawnCodexAppServer } from './codex-app-server-process.js'
import { asKillTarget, isHostProcessLaunchAlive, terminateProcessTree } from './process-tree-cleanup.js'
import type { HarnessAdapter, HarnessSession, HarnessSessionResult } from './types.js'
import { fetchRunWorkflowHint } from './workflow-hint.js'
export class CodexAppServerHarnessAdapter implements HarnessAdapter {
  private readonly apiUrl: string
  private readonly sessions = new Map<string, ActiveSession>()
  /** Callback for evaluating tool approvals via Edictum. Injected at construction or defaults to auto-approve. */
  private readonly evaluateApproval: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
  constructor(
    apiUrl: string,
    options?: {
      evaluateApproval?: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
    },
  ) {
    this.apiUrl = apiUrl
    this.evaluateApproval = options?.evaluateApproval ?? (async () => true)
  }
  async spawn(
    run: Run,
    task: Task,
    systemPrompt: string,
    _mcpServer: DispatcherMcpServer,
    options?: SpawnOptions,
  ): Promise<HarnessSession> {
    const workingDir = options?.workingDir ?? process.cwd()
    const agentWorkingDir = options?.sandbox?.podman?.workdir ?? workingDir
    const sessionId = `codex-as-${run.id}-${Date.now()}`
    const mcpServerName = buildCodexMcpServerName(run.id)
    const normalizedModel = normalizeCodexModel(options?.agent?.model) ?? null
    let resolveCompletion: (r: HarnessSessionResult) => void
    const completion = new Promise<HarnessSessionResult>((resolve) => {
      resolveCompletion = resolve
    })
    const sessionEnv = {
      ...options?.env,
      ...(options?.controlToken == null ? {} : { DUCTUM_CONTROL_TOKEN: options.controlToken }),
    }
    const workerStartedAt = new Date().toISOString()
    const { child, ownership } = spawnCodexAppServer(workingDir, buildCodexAppServerEnv(this.apiUrl, run.id, sessionEnv), options?.sandbox)
    const mcpConfigEnv = options?.sandbox?.driver === 'container' ? buildCodexContainerMcpEnv(sessionEnv) : sessionEnv
    const active: ActiveSession = {
      runId: run.id,
      sessionId,
      controlToken: options?.controlToken ?? null,
      child,
      childOwnership: ownership,
      model: normalizedModel,
      threadId: null,
      killRequested: false,
      killReason: 'killed',
      completed: false,
      heartbeatTimer: null,
      tokensIn: 0,
      tokensOut: 0,
      nextRequestId: 1,
      pendingToolApprovals: new Map(),
      pendingRequests: new Map(),
      failureResult: null,
      completion,
      resolveCompletion: resolveCompletion!,
      terminateChild: async () => {
        await terminateProcessTree(asKillTarget(child), ownership)
      },
    }
    this.sessions.set(sessionId, active)
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      this.handleMessage(active, line, run, systemPrompt, task)
    })

    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) log.warn('codex-as', `[${sessionId.slice(0, 16)}] stderr: ${msg.slice(0, 200)}`)
    })

    child.once('error', (error) => {
      const message = formatUnknownError(error)
      log.error('codex-as', `[${sessionId.slice(0, 16)}] failed to launch: ${message}`)
      if (!active.completed) {
        active.completed = true
        const cost = resolveUsageCostTruth(active.model, active.tokensIn, active.tokensOut)
        active.resolveCompletion?.({
          exitReason: 'crashed',
          tokensIn: active.tokensIn,
          tokensOut: active.tokensOut,
          costUsd: cost.costUsd,
          costState: cost.state,
        })
      }
      this.cleanup(active, new Error(`codex app-server failed to launch: ${message}`))
    })

    child.on('exit', (code, signal) => {
      log.info('codex-as', `[${sessionId.slice(0, 16)}] exited: code=${code} signal=${signal}`)
      if (!active.completed) {
        active.completed = true
        const cost = resolveUsageCostTruth(active.model, active.tokensIn, active.tokensOut)
        active.resolveCompletion?.(active.failureResult ?? {
          exitReason: active.killRequested
            ? (active.killReason === 'completed' ? 'completed' : 'killed')
            : code === 0
              ? 'completed'
              : 'crashed',
          tokensIn: active.tokensIn,
          tokensOut: active.tokensOut,
          costUsd: cost.costUsd,
          costState: cost.state,
        })
      }
      this.cleanup(active)
    })

    active.heartbeatTimer = setInterval(() => {
      void emitHarnessEvent(this.apiUrl, run.id, { type: 'heartbeat' }, active.controlToken).catch(() => undefined)
    }, HEARTBEAT_INTERVAL_MS)

    await this.sendRequest(active, 'initialize', {
      clientInfo: { name: 'ductum', version: '0.1.0' },
      capabilities: null,
    })
    this.sendNotification(active, 'initialized')

    const workflowHint = `${await fetchRunWorkflowHint(this.apiUrl, run.id)}${buildCodexMcpToolHint(run.id)}`

    const threadResult = await this.sendRequest(active, 'thread/start', {
      model: normalizedModel ?? undefined,
      modelReasoningEffort: normalizeCodexEffort(options?.agent?.effort),
      cwd: agentWorkingDir,
      approvalPolicy: 'untrusted',
      sandbox: 'workspace-write',
      config: buildCodexMcpThreadConfig(this.apiUrl, run.id, mcpConfigEnv),
      baseInstructions: `${systemPrompt}${workflowHint}`,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    }) as { thread?: { id?: string } }

    active.threadId = threadResult?.thread?.id ?? null
    log.info('codex-as', `[${sessionId.slice(0, 16)}] thread started: ${active.threadId} mcp=${mcpServerName}`)

    if (active.threadId) {
      await emitHarnessEvent(this.apiUrl, run.id, { type: 'session.started', harnessSessionId: active.threadId }).catch(() => undefined)
      this.sendRequest(active, 'turn/start', {
        threadId: active.threadId,
        input: [{ type: 'text', text: task.prompt }],
      }).catch((err) => {
        log.error('codex-as', `[${sessionId.slice(0, 16)}] turn/start error: ${formatUnknownError(err)}`)
      })
    }

    return {
      sessionId,
      harnessSessionId: active.threadId,
      workerPid: ownership.pid, workerOwnershipKind: ownership.kind, workerStartedAt, workerOwnershipUnsupportedReason: ownership.unsupportedReason ?? null,
      runId: run.id,
      ...(options?.sandbox?.podman == null ? {} : { sandboxExecution: { agentProcess: 'podman-container' as const, containerId: options.sandbox.podman.containerId, workdir: options.sandbox.podman.workdir } }),
      waitForCompletion: async () => await completion,
    }
  }

  async kill(sessionId: string, reason: 'killed' | 'completed' | 'cancelled' = 'killed'): Promise<void> {
    const active = this.sessions.get(sessionId)
    if (active == null) return
    active.killRequested = true
    active.killReason = reason === 'cancelled' ? 'killed' : reason
    await active.terminateChild()
    if (active.killReason === 'killed') {
      this.cleanup(active)
    }
  }

  async isAlive(sessionId: string): Promise<boolean> {
    const active = this.sessions.get(sessionId)
    if (active == null || active.completed || active.killRequested) return false
    if (isHostProcessLaunchAlive({ child: active.child, ownership: active.childOwnership })) return true

    completeDeadCodexAppServerSession(active)
    this.cleanup(active, new Error('codex app-server worker is no longer alive'))
    return false
  }

  private handleMessage(active: ActiveSession, line: string, run: Run, _systemPrompt: string, _task: Task): void {
    if (!line.trim()) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }
    if (msg.id != null && (msg.result !== undefined || msg.error != null)) {
      const pending = active.pendingRequests.get(msg.id)
      if (pending) {
        active.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(`${msg.error.message} (${msg.error.code})`))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }
    if (msg.id != null && msg.method != null) {
      const emit = (runId: RunId, event: import('./types.js').HarnessEvent) => this.emitEvent(runId, event, active.controlToken)
      void handleServerRequest(active, msg, run, this.createServerRequestCallbacks(active), emit)
      return
    }
    if (msg.method != null) {
      handleNotification(active, msg, run, (runId, event) => this.emitEvent(runId, event, active.controlToken))
    }
  }

  private emitEvent(runId: RunId, event: import('./types.js').HarnessEvent, controlToken?: string | null): void {
    void emitHarnessEvent(this.apiUrl, runId, event, controlToken).catch(() => undefined)
  }

  private createServerRequestCallbacks(active: ActiveSession) {
    return {
      sendResponse: (id: string | number, result: unknown) => {
        const msg = JSON.stringify({ jsonrpc: '2.0', id, result })
        active.child.stdin.write(msg + '\n')
      },
      sendErrorResponse: (id: string | number, error: { code: number; message: string }) => {
        const msg = JSON.stringify({ jsonrpc: '2.0', id, error })
        active.child.stdin.write(msg + '\n')
      },
      evaluateApproval: this.evaluateApproval.bind(this),
      recordToolApproval: (params: unknown, allowed: boolean, approval: PendingCodexToolApproval) => {
        this.recordToolApproval(active, params, allowed, approval)
      },
    }
  }

  private sendRequest(active: ActiveSession, method: string, params: unknown): Promise<unknown> {
    const id = active.nextRequestId++
    return new Promise((resolve, reject) => {
      if (active.completed) {
        reject(new Error('Session terminated'))
        return
      }
      active.pendingRequests.set(id, { resolve, reject })
      const msg = JSON.stringify({ id, method, params })
      active.child.stdin.write(msg + '\n')
      setTimeout(() => {
        if (active.pendingRequests.has(id)) {
          active.pendingRequests.delete(id)
          reject(new Error(`Request ${method} timed out`))
        }
      }, 30_000)
    })
  }

  private sendNotification(active: ActiveSession, method: string, params?: unknown): void {
    const msg = JSON.stringify({ method, ...(params != null ? { params } : {}) })
    active.child.stdin.write(msg + '\n')
  }

  private recordToolApproval(
    active: ActiveSession,
    params: unknown,
    allowed: boolean,
    approval: PendingCodexToolApproval,
  ): void {
    const itemId = getCodexItemId(params)
    if (itemId == null) return
    if (!allowed) {
      active.pendingToolApprovals.delete(itemId)
      return
    }
    active.pendingToolApprovals.set(itemId, approval)
  }

  private cleanup(active: ActiveSession, reason = new Error('Session terminated')): void {
    if (active.heartbeatTimer != null) {
      clearInterval(active.heartbeatTimer)
      active.heartbeatTimer = null
    }
    for (const [, pending] of active.pendingRequests) {
      pending.reject(reason)
    }
    active.pendingRequests.clear()
    this.sessions.delete(active.sessionId)
  }
}
