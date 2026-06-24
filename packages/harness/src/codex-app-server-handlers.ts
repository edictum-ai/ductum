/**
 * Codex app-server message handlers.
 *
 * Extracted from codex-app-server.ts. Handles incoming JSON-RPC server requests
 * (approval hooks, permissions, etc.) and server notifications (turn lifecycle,
 * token usage, etc.). Pure logic + callbacks — no transport or child-process
 * state.
 */

import type { Run, RunId } from '@ductum/core'
import { formatUnknownError, log, resolveUsageCostTruth } from '@ductum/core'

import { emitHarnessEvent } from './canonical-events.js'
import {
  getCodexItemId,
  resolveCodexCommandApproval,
  resolveCodexCompletedToolResults,
  type PendingCodexToolApproval,
} from './codex-app-server-events.js'
import { buildCodexMcpServerName } from './codex-mcp-config.js'
import { routeNonInteractiveRequest } from './codex-server-request-routing.js'
import type { ActiveSession, JsonRpcMessage } from './codex-app-server-types.js'
import type { HarnessEvent } from './types.js'

// ---------------------------------------------------------------------------
// Callback interfaces
// ---------------------------------------------------------------------------

/** Transport and state callbacks needed by the server-request handler. */
export interface ServerRequestCallbacks {
  sendResponse: (id: string | number, result: unknown) => void
  sendErrorResponse: (id: string | number, error: { code: number; message: string }) => void
  evaluateApproval: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
  recordToolApproval: (params: unknown, allowed: boolean, approval: PendingCodexToolApproval) => void
}

/** Callback for emitting Ductum harness events. */
export type EmitEventFn = (runId: RunId, event: HarnessEvent) => void

// ---------------------------------------------------------------------------
// Server request handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming JSON-RPC server request (method + id, expects a response).
 *
 * Interactive approval paths (`commandExecution`, `fileChange`) evaluate policy
 * through the injected `evaluateApproval` callback. All other methods are
 * routed through `routeNonInteractiveRequest`.
 */
export async function handleServerRequest(
  active: ActiveSession,
  msg: JsonRpcMessage,
  run: Run,
  callbacks: ServerRequestCallbacks,
  emitEvent: EmitEventFn,
): Promise<void> {
  const params = msg.params as Record<string, unknown> | undefined
  const tag = `[${active.sessionId.slice(0, 16)}]`

  switch (msg.method) {
    case 'item/commandExecution/requestApproval': {
      const command = String(params?.command ?? '')
      const approval = resolveCodexCommandApproval(command)
      emitEvent(run.id, { type: 'needs_approval', toolName: 'Bash', args: { command }, content: command })
      const allowed = await callbacks.evaluateApproval(run.id, 'Bash', { command })
      const decision = allowed ? 'accept' : 'decline'
      callbacks.recordToolApproval(params, allowed, approval)
      emitEvent(run.id, allowed
        ? { type: 'tool.requested', toolName: 'Bash', args: { command }, content: command }
        : { type: 'tool.blocked', toolName: 'Bash', args: { command }, content: command })
      log.info('codex-as', `${tag} command approval: ${decision} — ${command.slice(0, 80)}`)
      callbacks.sendResponse(msg.id!, { decision })
      break
    }

    case 'item/fileChange/requestApproval': {
      emitEvent(run.id, { type: 'needs_approval', toolName: 'Write', args: params ?? {} })
      const allowed = await callbacks.evaluateApproval(run.id, 'Write', params ?? {})
      const decision = allowed ? 'accept' : 'decline'
      callbacks.recordToolApproval(params, allowed, { toolName: 'Write', args: params ?? {} })
      emitEvent(run.id, allowed
        ? { type: 'tool.requested', toolName: 'Write', args: params ?? {} }
        : { type: 'tool.blocked', toolName: 'Write', args: params ?? {} })
      log.info('codex-as', `${tag} file change approval: ${decision}`)
      callbacks.sendResponse(msg.id!, { decision })
      break
    }

    case 'item/permissions/requestApproval':
    case 'mcpServer/elicitation/request':
    case 'item/tool/requestUserInput':
    case 'account/chatgptAuthTokens/refresh':
    case 'applyPatchApproval':
    case 'execCommandApproval':
    case 'item/tool/call':
    default: {
      const routed = routeNonInteractiveRequest(msg.method ?? 'unknown', params, {
        trustedMcpServerNames: ['ductum', buildCodexMcpServerName(run.id)],
      })
      for (const event of routed.events) {
        emitEvent(run.id, event)
      }
      if (routed.isError) {
        log.warn('codex-as', `${tag} server request error: ${routed.error?.message ?? 'unknown'}`)
        callbacks.sendErrorResponse(msg.id!, routed.error!)
      } else {
        if (routed.events.length > 0) {
          const ev = routed.events[0] as Extract<import('./types.js').HarnessEvent, { type: 'tool.blocked' }> | undefined
          log.info('codex-as', `${tag} non-interactive ${msg.method}: ${ev?.reason ?? 'handled'}`)
        }
        callbacks.sendResponse(msg.id!, routed.result)
      }
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Notification handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming JSON-RPC server notification (method, no id, no response
 * expected).
 *
 * Updates session state in-place and emits Ductum harness events.
 */
export function handleNotification(
  active: ActiveSession,
  msg: JsonRpcMessage,
  run: Run,
  emitEvent: EmitEventFn,
): void {
  const params = msg.params as Record<string, unknown> | undefined

  switch (msg.method) {
    case 'thread/started': {
      const threadId = String(params?.threadId ?? '')
      if (threadId) active.threadId = threadId
      break
    }

    case 'turn/completed': {
      log.info('codex-as', `[${active.sessionId.slice(0, 16)}] turn completed`)
      emitEvent(run.id, { type: 'completed' })
      active.completed = true
      const cost = resolveUsageCostTruth(active.model, active.tokensIn, active.tokensOut)
      active.resolveCompletion?.({
        exitReason: 'completed',
        tokensIn: active.tokensIn,
        tokensOut: active.tokensOut,
        costUsd: cost.costUsd,
        costState: cost.state,
      })
      break
    }

    case 'thread/tokenUsage/updated': {
      const usage = params as { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | undefined
      if (usage) {
        const cumulativeIn = usage.inputTokens ?? active.tokensIn
        const cumulativeOut = usage.outputTokens ?? active.tokensOut
        const deltaIn = Math.max(0, cumulativeIn - active.tokensIn)
        const deltaOut = Math.max(0, cumulativeOut - active.tokensOut)
        active.tokensIn = cumulativeIn
        active.tokensOut = cumulativeOut
        if (deltaIn > 0 || deltaOut > 0) {
          const cost = resolveUsageCostTruth(active.model, deltaIn, deltaOut)
          emitEvent(run.id, {
            type: 'cost.updated',
            usage: {
              tokensIn: deltaIn,
              tokensOut: deltaOut,
              costUsd: cost.costUsd,
              model: active.model ?? undefined,
              costState: cost.state,
            },
          })
        }
      }
      break
    }

    case 'item/agentMessage/delta': {
      const text = String(params?.delta ?? '')
      if (text.length > 10) {
        emitEvent(run.id, { type: 'text.delta', content: text })
      }
      break
    }

    case 'item/completed': {
      const itemId = getCodexItemId(params)
      const approved = itemId == null ? null : active.pendingToolApprovals.get(itemId)
      if (itemId != null) active.pendingToolApprovals.delete(itemId)
      for (const resultEvent of resolveCodexCompletedToolResults(params, approved)) {
        emitEvent(run.id, resultEvent)
      }
      break
    }

    case 'error': {
      const detail = params?.error ?? params?.message ?? 'unknown error'
      const errorMsg = formatUnknownError(detail)
      log.error('codex-as', `[${active.sessionId.slice(0, 16)}] server error: ${errorMsg}`)
      const cost = resolveUsageCostTruth(active.model, active.tokensIn, active.tokensOut)
      active.failureResult = {
        exitReason: 'failed',
        failReason: `codex app-server error: ${errorMsg}`,
        failureEvidence: {
          category: 'terminal',
          kind: 'codex-app-server-error',
          detail,
        },
        tokensIn: active.tokensIn,
        tokensOut: active.tokensOut,
        costUsd: cost.costUsd,
        costState: cost.state,
      }
      active.completed = true
      active.resolveCompletion?.(active.failureResult)
      void active.terminateChild()
      break
    }
  }
}
