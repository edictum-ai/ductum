import type { FencingToken } from './attempt-lease.js'
import type { HarnessSessionResult, SpawnOptions } from './dispatcher-support.js'
import type { EvidenceRepo } from './repos/interfaces.js'
import { createId, type RunId, type Task } from './types.js'

export interface AttemptResourceCeilings {
  maxInputTokensPerTurn?: number | null
  maxCumulativeCostUsd?: number | null
  maxTurns?: number | null
}

export interface AttemptResourceCeilingSettings extends AttemptResourceCeilings {
  enabled?: boolean | null
}

export interface AttemptResourceCeilingSummary extends Required<AttemptResourceCeilings> {
  enabled: boolean
  source: 'default' | 'configured' | 'disabled'
}

export const DEFAULT_ATTEMPT_RESOURCE_CEILINGS = {
  maxInputTokensPerTurn: 2_000_000,
  maxCumulativeCostUsd: 100,
  maxTurns: 200,
} as const satisfies Required<AttemptResourceCeilings>

export interface AttemptResourceCeilingHit {
  ceiling: keyof AttemptResourceCeilings
  observed: number
  cap: number
  originalExitReason: HarnessSessionResult['exitReason']
  nextExitReason: HarnessSessionResult['exitReason']
  detail: string
}

export function normalizeAttemptResourceCeilings(input: AttemptResourceCeilingSettings | null | undefined): AttemptResourceCeilings | undefined {
  if (input == null || input.enabled === false) return undefined
  const ceilings = {
    maxInputTokensPerTurn: normalizeCeilingValue(input, 'maxInputTokensPerTurn'),
    maxCumulativeCostUsd: normalizeCeilingValue(input, 'maxCumulativeCostUsd'),
    maxTurns: normalizeCeilingValue(input, 'maxTurns'),
  }
  return Object.values(ceilings).some((value) => value != null) ? ceilings : undefined
}

export function resolveAttemptResourceCeilings(input: AttemptResourceCeilingSettings | null | undefined): AttemptResourceCeilings | undefined {
  if (input == null) return { ...DEFAULT_ATTEMPT_RESOURCE_CEILINGS }
  return normalizeAttemptResourceCeilings(input)
}

export function describeAttemptResourceCeilings(input: AttemptResourceCeilingSettings | null | undefined): AttemptResourceCeilingSummary {
  const ceilings = resolveAttemptResourceCeilings(input)
  if (ceilings == null) {
    return {
      enabled: false,
      source: 'disabled',
      maxInputTokensPerTurn: null,
      maxCumulativeCostUsd: null,
      maxTurns: null,
    }
  }
  return {
    enabled: true,
    source: input == null ? 'default' : 'configured',
    maxInputTokensPerTurn: ceilings.maxInputTokensPerTurn ?? null,
    maxCumulativeCostUsd: ceilings.maxCumulativeCostUsd ?? null,
    maxTurns: ceilings.maxTurns ?? null,
  }
}

export function effectiveAttemptCeilingsForTask(
  input: AttemptResourceCeilingSettings | null | undefined,
  task: Task | null,
): AttemptResourceCeilingSettings {
  const ceilings = resolveAttemptResourceCeilings(input)
  if (ceilings == null) return { enabled: false }
  return {
    ...ceilings,
    maxTurns: ceilings.maxTurns == null ? null : ceilings.maxTurns + Math.max(0, task?.turnExtraCount ?? 0),
    maxCumulativeCostUsd: ceilings.maxCumulativeCostUsd == null ? null : ceilings.maxCumulativeCostUsd + Math.max(0, task?.budgetExtraUsd ?? 0),
  }
}

export function attemptCeilingSpawnOptions(
  input: AttemptResourceCeilingSettings | null | undefined,
  task: Task | null,
): Pick<SpawnOptions, 'maxTurns' | 'maxBudgetUsd'> {
  const ceilings = effectiveAttemptCeilingsForTask(input, task)
  return {
    ...(ceilings.maxTurns == null ? {} : { maxTurns: ceilings.maxTurns }),
    ...(ceilings.maxCumulativeCostUsd == null ? {} : { maxBudgetUsd: ceilings.maxCumulativeCostUsd }),
  }
}

export function applyAttemptResourceCeilings(
  result: HarnessSessionResult,
  input: AttemptResourceCeilingSettings | null | undefined,
  options: { cumulativeCostUsd?: number | null } = {},
): { result: HarnessSessionResult; hit: AttemptResourceCeilingHit | null } {
  const ceilings = resolveAttemptResourceCeilings(input)
  if (ceilings == null) return { result, hit: null }
  const turnInput = nonNegative(result.maxInputTokensInTurn) ?? nonNegative(result.tokensIn)
  const firstTurnOverflow = firstTurnPromptOverflow(result)
  if (firstTurnOverflow && ceilings.maxInputTokensPerTurn != null) {
    const cap = ceilings.maxInputTokensPerTurn
    const observed = Math.max(turnInput ?? 0, cap + 1)
    const hit = buildCeilingHit('maxInputTokensPerTurn', observed, cap, result, 'paused-max-turns')
    return { result: toPolicyPause(result, hit), hit }
  }
  const checks: Array<[keyof AttemptResourceCeilings, number | null, number | null, HarnessSessionResult['exitReason']]> = [
    ['maxInputTokensPerTurn', turnInput, ceilings.maxInputTokensPerTurn ?? null, 'paused-max-turns'],
    ['maxCumulativeCostUsd', nonNegative(options.cumulativeCostUsd) ?? nonNegative(result.costUsd), ceilings.maxCumulativeCostUsd ?? null, 'paused-cost-budget'],
    ['maxTurns', nonNegative(result.turns), ceilings.maxTurns ?? null, 'paused-max-turns'],
  ]
  for (const [ceiling, observed, cap, nextExitReason] of checks) {
    if (observed == null || cap == null || observed <= cap) continue
    const hit = buildCeilingHit(ceiling, observed, cap, result, nextExitReason)
    return { result: toPolicyPause(result, hit), hit }
  }
  return { result, hit: null }
}

export function recordAttemptResourceCeilingEvidence(
  evidenceRepo: EvidenceRepo | undefined,
  runId: RunId,
  hit: AttemptResourceCeilingHit,
  fenceToken?: FencingToken,
  fenceNow?: Date,
): void {
  if (evidenceRepo == null) return
  const evidence = {
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: { kind: 'attempt.resource_ceiling', schemaVersion: 1, retryable: true, ...hit },
  } as const
  if (fenceToken != null && evidenceRepo.createFenced != null) evidenceRepo.createFenced(evidence, fenceToken, fenceNow)
  else evidenceRepo.create(evidence)
}

function toPolicyPause(result: HarnessSessionResult, hit: AttemptResourceCeilingHit): HarnessSessionResult {
  return {
    ...result,
    exitReason: hit.nextExitReason,
    failReason: hit.ceiling,
    failureEvidence: { ...(result.failureEvidence ?? {}), category: 'policy', ceiling: hit.ceiling, observed: hit.observed, cap: hit.cap },
    pauseDetail: { detail: hit.detail, cap: hit.cap },
  }
}

function buildCeilingHit(
  ceiling: keyof AttemptResourceCeilings,
  observed: number,
  cap: number,
  result: HarnessSessionResult,
  nextExitReason: HarnessSessionResult['exitReason'],
): AttemptResourceCeilingHit {
  return {
    ceiling,
    observed,
    cap,
    originalExitReason: result.exitReason,
    nextExitReason,
    detail: formatCeilingDetail(ceiling, observed, cap),
  }
}

function formatCeilingDetail(ceiling: keyof AttemptResourceCeilings, observed: number, cap: number): string {
  if (ceiling === 'maxCumulativeCostUsd') return `attempt cumulative cost ${formatUsd(observed)} exceeded cap ${formatUsd(cap)}`
  if (ceiling === 'maxTurns') return `attempt turns ${observed} exceeded cap ${cap}`
  return `attempt input tokens per turn ${observed} exceeded cap ${cap}`
}

function normalizeCeilingValue(input: AttemptResourceCeilingSettings, key: keyof AttemptResourceCeilings): number | null {
  if (Object.prototype.hasOwnProperty.call(input, key)) return positive(input[key])
  return DEFAULT_ATTEMPT_RESOURCE_CEILINGS[key]
}

function firstTurnPromptOverflow(result: HarnessSessionResult): boolean {
  const reason = result.failReason ?? ''
  const completedTurns = nonNegative(result.turns) ?? 0
  return result.exitReason === 'failed' && completedTurns === 0 && /prompt[_ -]?overflow/i.test(reason)
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`
}
