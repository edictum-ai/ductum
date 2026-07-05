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
  const ceilings: AttemptResourceCeilingSettings = {
    ...(parsed.enabled === true ? { enabled: true } : {}),
    maxInputTokensPerTurn: positive(parsed.maxInputTokensPerTurn),
    maxCumulativeCostUsd: positive(parsed.maxCumulativeCostUsd ?? parsed.maxCostUsd),
    maxTurns: positive(parsed.maxTurns),
  }
  return Object.values(ceilings).some((value) => value != null) ? ceilings : undefined
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function logInvalidAttemptCeilings(): void {
  log.warn('startup', 'invalid DUCTUM_ATTEMPT_CEILINGS; using Factory Settings/default attempt ceilings')
}
