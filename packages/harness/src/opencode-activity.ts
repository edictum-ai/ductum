import type { RunId } from '@ductum/core'
import { log } from '@ductum/core'

import { emitHarnessEvent } from './canonical-events.js'
import type { OpenCodeSessionMessageWithParts } from './opencode-rest.js'
import type { TokenUsageDelta } from './types.js'

/**
 * Tracks which messages have been processed and accumulated token usage.
 * Mirrors the UsageCursor pattern from the Claude adapter so that token
 * deltas are posted incrementally, not just at session end.
 */
export interface ActivityCursor {
  /** Index of the next unprocessed message in the messages array. */
  nextIndex: number
  /** Cumulative tokens posted so far (for computing deltas). */
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export function createActivityCursor(): ActivityCursor {
  return { nextIndex: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }
}

/**
 * Process new messages since the last cursor position.
 * For each new assistant message:
 * - Posts activity entries (text, tool_call) for each message part
 * - Posts token deltas to the dashboard for live tracking
 *
 * Returns the updated cursor (mutates in place for convenience).
 */
export function processNewMessages(
  apiUrl: string,
  runId: RunId,
  messages: OpenCodeSessionMessageWithParts[],
  cursor: ActivityCursor,
  controlToken?: string | null,
): ActivityCursor {
  const tag = `[opencode:${String(runId).slice(0, 12)}]`

  for (let i = cursor.nextIndex; i < messages.length; i++) {
    const message = messages[i]!
    if (message.info.role !== 'assistant') {
      continue
    }

    // Post activity entries for each part
    for (const part of message.parts) {
      postPartActivity(apiUrl, runId, tag, part)
    }

    // Post token delta for this message
    const delta = computeTokenDelta(message, cursor)
    if (delta.tokensIn > 0 || delta.tokensOut > 0 || delta.costUsd > 0) {
      cursor.tokensIn += delta.tokensIn
      cursor.tokensOut += delta.tokensOut
      cursor.costUsd += delta.costUsd
      void emitHarnessEvent(apiUrl, runId, { type: 'cost.updated', usage: delta }, controlToken).catch(() => undefined)
    }
  }

  cursor.nextIndex = messages.length
  return cursor
}

/**
 * Post a completion activity entry when the session finishes.
 */
export function postCompletionActivity(
  apiUrl: string,
  runId: RunId,
  exitReason: string,
  cursor: ActivityCursor,
): void {
  const cost = cursor.costUsd > 0 ? ` $${roundUsd(cursor.costUsd)}` : ''
  const msg = `session ended - ${exitReason}${cost}`
  void emitHarnessEvent(apiUrl, runId, { type: 'completed', content: msg }).catch(() => undefined)
}

// ---- Internal helpers ----

/** Loosely-typed part with optional fields we extract from OpenCode messages. */
interface MessagePart {
  type: string
  text?: string
  toolInvocation?: {
    toolName?: string
    args?: Record<string, unknown>
    state?: string
  }
  /** Alternative field names used by some OpenCode versions */
  toolName?: string
  args?: Record<string, unknown>
  name?: string
  input?: Record<string, unknown>
}

function postPartActivity(apiUrl: string, runId: RunId, tag: string, rawPart: { type: string }): void {
  const part = rawPart as MessagePart

  if (part.type === 'text' && part.text) {
    const preview = part.text.slice(0, 200).replace(/\n/g, ' ')
    log.info('opencode', `${tag} text: ${preview}`)
    void emitHarnessEvent(apiUrl, runId, { type: 'text.delta', content: part.text }).catch(() => undefined)
    return
  }

  if (part.type === 'tool-invocation' || part.type === 'tool_use' || part.type === 'tool-call') {
    const toolName = part.toolInvocation?.toolName ?? part.toolName ?? part.name ?? 'unknown'
    const args = part.toolInvocation?.args ?? part.args ?? part.input ?? {}
    const argsFull = JSON.stringify(args)
    const argsPreview = argsFull.slice(0, 200)
    log.info('opencode', `${tag} tool: ${toolName}(${argsPreview})`)
    void emitHarnessEvent(apiUrl, runId, {
      type: 'tool.requested',
      toolName,
      args,
      content: argsFull,
    }).catch(() => undefined)
    return
  }
}

function computeTokenDelta(
  message: OpenCodeSessionMessageWithParts,
  cursor: ActivityCursor,
): TokenUsageDelta {
  // OpenCode messages carry per-message usage (not cumulative),
  // so each message's tokens are treated as a delta directly.
  const tokensIn = message.info.tokens?.input ?? 0
  const tokensOut = message.info.tokens?.output ?? 0
  const costUsd = roundUsd(message.info.cost ?? 0)

  return { tokensIn, tokensOut, costUsd }
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
