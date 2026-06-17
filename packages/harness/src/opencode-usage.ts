import type { HarnessSessionResult } from './types.js'
import type { OpenCodeSessionMessageWithParts } from './opencode-rest.js'

export function summarizeOpenCodeUsage(
  messages: OpenCodeSessionMessageWithParts[],
  exitReason: HarnessSessionResult['exitReason'],
): HarnessSessionResult {
  let tokensIn = 0
  let tokensOut = 0
  let costUsd = 0
  let lastAssistantError: string | undefined

  for (const message of messages) {
    if (message.info.role !== 'assistant') {
      continue
    }

    tokensIn += message.info.tokens?.input ?? 0
    tokensOut += message.info.tokens?.output ?? 0
    costUsd += message.info.cost ?? 0
    lastAssistantError = message.info.error?.name ?? lastAssistantError
  }

  return {
    exitReason: classifyExitReason(exitReason, lastAssistantError),
    tokensIn,
    tokensOut,
    costUsd: roundUsd(costUsd),
  }
}

function classifyExitReason(
  fallback: HarnessSessionResult['exitReason'],
  lastAssistantError?: string,
): HarnessSessionResult['exitReason'] {
  if (fallback !== 'completed') {
    return fallback
  }
  if (lastAssistantError === 'MessageOutputLengthError') {
    return 'timeout'
  }
  if (lastAssistantError != null) {
    return 'crashed'
  }

  return 'completed'
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
