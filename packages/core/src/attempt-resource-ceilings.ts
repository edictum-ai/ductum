import type { FencingToken } from './attempt-lease.js'
import type { HarnessSessionResult } from './dispatcher-support.js'
import type { EvidenceRepo } from './repos/interfaces.js'
import { createId, type RunId } from './types.js'

export interface AttemptResourceCeilings {
  maxInputTokensPerTurn?: number | null
  maxCumulativeCostUsd?: number | null
  maxTurns?: number | null
}

export interface AttemptResourceCeilingHit {
  ceiling: keyof AttemptResourceCeilings
  observed: number
  cap: number
  originalExitReason: HarnessSessionResult['exitReason']
  nextExitReason: HarnessSessionResult['exitReason']
  detail: string
}

export function normalizeAttemptResourceCeilings(input: AttemptResourceCeilings | null | undefined): AttemptResourceCeilings | undefined {
  const ceilings = {
    maxInputTokensPerTurn: positive(input?.maxInputTokensPerTurn),
    maxCumulativeCostUsd: positive(input?.maxCumulativeCostUsd),
    maxTurns: positive(input?.maxTurns),
  }
  return Object.values(ceilings).some((value) => value != null) ? ceilings : undefined
}

export function applyAttemptResourceCeilings(
  result: HarnessSessionResult,
  input: AttemptResourceCeilings | null | undefined,
): { result: HarnessSessionResult; hit: AttemptResourceCeilingHit | null } {
  const ceilings = normalizeAttemptResourceCeilings(input)
  if (ceilings == null) return { result, hit: null }
  const turnInput = nonNegative(result.maxInputTokensInTurn) ?? nonNegative(result.tokensIn)
  const checks: Array<[keyof AttemptResourceCeilings, number | null, number | null, HarnessSessionResult['exitReason']]> = [
    ['maxInputTokensPerTurn', turnInput, ceilings.maxInputTokensPerTurn ?? null, 'paused-max-turns'],
    ['maxCumulativeCostUsd', nonNegative(result.costUsd), ceilings.maxCumulativeCostUsd ?? null, 'paused-cost-budget'],
    ['maxTurns', nonNegative(result.turns), ceilings.maxTurns ?? null, 'paused-max-turns'],
  ]
  for (const [ceiling, observed, cap, nextExitReason] of checks) {
    if (observed == null || cap == null || observed <= cap) continue
    const detail = formatCeilingDetail(ceiling, observed, cap)
    const hit: AttemptResourceCeilingHit = { ceiling, observed, cap, originalExitReason: result.exitReason, nextExitReason, detail }
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

function formatCeilingDetail(ceiling: keyof AttemptResourceCeilings, observed: number, cap: number): string {
  if (ceiling === 'maxCumulativeCostUsd') return `attempt cumulative cost ${formatUsd(observed)} exceeded cap ${formatUsd(cap)}`
  if (ceiling === 'maxTurns') return `attempt turns ${observed} exceeded cap ${cap}`
  return `attempt input tokens per turn ${observed} exceeded cap ${cap}`
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
