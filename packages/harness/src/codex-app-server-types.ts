/**
 * Shared types for the Codex app-server harness adapter.
 *
 * Extracted from codex-app-server.ts to keep the adapter under 300 LOC while
 * preserving a single source of truth for session state and JSON-RPC messages.
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { RunId } from '@ductum/core'

import type { PendingCodexToolApproval } from './codex-app-server-events.js'
import type { HostProcessTreeOwnership } from './process-tree-cleanup.js'
import type { HarnessSessionResult } from './types.js'

// ---------------------------------------------------------------------------
// JSON-RPC message type
// ---------------------------------------------------------------------------

export type JsonRpcMessage = {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ---------------------------------------------------------------------------
// Active session state
// ---------------------------------------------------------------------------

export interface ActiveSession {
  runId: RunId
  sessionId: string
  controlToken: string | null
  child: ChildProcessWithoutNullStreams
  childOwnership: HostProcessTreeOwnership
  model: string | null
  threadId: string | null
  killRequested: boolean
  /** See HarnessAdapter.kill. 'completed' signals the dispatcher is
   *  terminating the session cleanly because ductum.complete fired. */
  killReason: 'killed' | 'completed'
  completed: boolean
  heartbeatTimer: NodeJS.Timeout | null
  tokensIn: number
  tokensOut: number
  turnCount: number
  maxInputTokensInTurn: number
  nextRequestId: number
  pendingToolApprovals: Map<string, PendingCodexToolApproval>
  pendingRequests: Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  failureResult: HarnessSessionResult | null
  completion: Promise<HarnessSessionResult>
  resolveCompletion: ((r: HarnessSessionResult) => void) | null
  terminateChild: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Heartbeat interval
// ---------------------------------------------------------------------------

/**
 * Heartbeat interval (ms). Reads `DUCTUM_HEARTBEAT_INTERVAL_MS` from
 * the environment so operators can dial it from Factory Settings (the
 * runtime settings stored in the Factory DB) without patching the
 * harness. Defaults to 30s.
 */
export const HEARTBEAT_INTERVAL_MS = (() => {
  const raw = process.env.DUCTUM_HEARTBEAT_INTERVAL_MS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000
})()

export function resultTelemetry(active: ActiveSession): Pick<HarnessSessionResult, 'turns' | 'maxInputTokensInTurn'> {
  const hasUsage = active.tokensIn > 0 || active.tokensOut > 0
  const turns = active.turnCount > 0 ? active.turnCount : hasUsage ? 1 : 0
  return {
    turns,
    maxInputTokensInTurn: Math.max(active.maxInputTokensInTurn, hasUsage ? active.tokensIn : 0),
  }
}
