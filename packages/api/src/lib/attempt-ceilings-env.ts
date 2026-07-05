import { log, type AttemptResourceCeilingSettings } from '@ductum/core'

export function readAttemptResourceCeilings(
  factorySettings?: AttemptResourceCeilingSettings | null,
  raw = process.env.DUCTUM_ATTEMPT_CEILINGS,
): AttemptResourceCeilingSettings | null | undefined {
  if (raw == null || raw.trim() === '') return factorySettings
  if (/^(false|off|disabled)$/i.test(raw.trim())) return { enabled: false }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return attemptCeilingSettings(parsed) ?? factorySettings
  } catch {
    logInvalidAttemptCeilings()
    return factorySettings
  }
}

function attemptCeilingSettings(parsed: Record<string, unknown>): AttemptResourceCeilingSettings | undefined {
  if (parsed.enabled === false) return { enabled: false }
  const ceilings: AttemptResourceCeilingSettings = parsed.enabled === true ? { enabled: true } : {}
  const maxInputTokensPerTurn = positive(parsed.maxInputTokensPerTurn)
  const maxCumulativeCostUsd = positive(parsed.maxCumulativeCostUsd ?? parsed.maxCostUsd)
  const maxTurns = positive(parsed.maxTurns)
  if (maxInputTokensPerTurn != null) ceilings.maxInputTokensPerTurn = maxInputTokensPerTurn
  if (maxCumulativeCostUsd != null) ceilings.maxCumulativeCostUsd = maxCumulativeCostUsd
  if (maxTurns != null) ceilings.maxTurns = maxTurns
  return Object.keys(ceilings).length > 0 ? ceilings : undefined
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function logInvalidAttemptCeilings(): void {
  log.warn('startup', 'invalid DUCTUM_ATTEMPT_CEILINGS; using Factory Settings/default attempt ceilings')
}
