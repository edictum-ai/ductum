import { log, type AttemptResourceCeilings } from '@ductum/core'

export function readAttemptResourceCeilings(raw = process.env.DUCTUM_ATTEMPT_CEILINGS): AttemptResourceCeilings | undefined {
  if (raw == null || raw.trim() === '') return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const ceilings: AttemptResourceCeilings = {
      maxInputTokensPerTurn: positive(parsed.maxInputTokensPerTurn),
      maxCumulativeCostUsd: positive(parsed.maxCumulativeCostUsd ?? parsed.maxCostUsd),
      maxTurns: positive(parsed.maxTurns),
    }
    return Object.values(ceilings).some((value) => value != null) ? ceilings : undefined
  } catch {
    logInvalidAttemptCeilings()
    return undefined
  }
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function logInvalidAttemptCeilings(): void {
  log.warn('startup', 'invalid DUCTUM_ATTEMPT_CEILINGS; attempt resource ceilings disabled')
}
