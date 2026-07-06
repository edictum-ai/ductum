import type { FencingToken } from './attempt-lease.js'
import type { HarnessSessionResult, SpawnOptions } from './dispatcher-support.js'
import { resolveModelEntry } from './model-registry.js'
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

export const DEFAULT_MODEL_INPUT_TOKEN_CEILING_RATIO = 0.9

export interface AttemptResourceCeilingContext {
  model?: string | null
}

export interface AttemptResourceCeilingTelemetry {
  tokensIn: number
  tokensOut: number
  costUsd: number
  turns: number | null
  maxInputTokensInTurn: number | null
  failReason?: string
}

export interface AttemptResourceCeilingHit {
  ceiling: keyof AttemptResourceCeilings
  observed: number
  cap: number
  originalExitReason: HarnessSessionResult['exitReason']
  nextExitReason: HarnessSessionResult['exitReason']
  detail: string
  observedTelemetry: AttemptResourceCeilingTelemetry
}

export function modelPromptRejectionThresholdTokens(model: string | null | undefined): number | null {
  return resolveModelEntry(model)?.promptRejectionThresholdTokens ?? null
}

export function defaultMaxInputTokensPerTurnForModel(model: string | null | undefined): number {
  const threshold = modelPromptRejectionThresholdTokens(model)
  if (threshold == null) return DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn
  return Math.max(1, Math.floor(threshold * DEFAULT_MODEL_INPUT_TOKEN_CEILING_RATIO))
}

export function normalizeAttemptResourceCeilings(
  input: AttemptResourceCeilingSettings | null | undefined,
  context: AttemptResourceCeilingContext = {},
): AttemptResourceCeilings | undefined {
  if (input == null || input.enabled === false) return undefined
  const ceilings = {
    maxInputTokensPerTurn: normalizeCeilingValue(input, 'maxInputTokensPerTurn', context),
    maxCumulativeCostUsd: normalizeCeilingValue(input, 'maxCumulativeCostUsd', context),
    maxTurns: normalizeCeilingValue(input, 'maxTurns', context),
  }
  return Object.values(ceilings).some((value) => value != null) ? ceilings : undefined
}

export function resolveAttemptResourceCeilings(
  input: AttemptResourceCeilingSettings | null | undefined,
  context: AttemptResourceCeilingContext = {},
): AttemptResourceCeilings | undefined {
  if (input == null) return {
    ...DEFAULT_ATTEMPT_RESOURCE_CEILINGS,
    maxInputTokensPerTurn: defaultMaxInputTokensPerTurnForModel(context.model),
  }
  return normalizeAttemptResourceCeilings(input, context)
}

export function describeAttemptResourceCeilings(
  input: AttemptResourceCeilingSettings | null | undefined,
  context: AttemptResourceCeilingContext = {},
): AttemptResourceCeilingSummary {
  const ceilings = resolveAttemptResourceCeilings(input, context)
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
  context: AttemptResourceCeilingContext = {},
): AttemptResourceCeilingSettings {
  const ceilings = resolveAttemptResourceCeilings(input, context)
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
  options: { cumulativeCostUsd?: number | null; model?: string | null } = {},
): Pick<SpawnOptions, 'maxTurns' | 'maxBudgetUsd'> {
  const ceilings = effectiveAttemptCeilingsForTask(input, task, options)
  const remainingCostUsd = remainingCeilingBudget(ceilings.maxCumulativeCostUsd, options.cumulativeCostUsd)
  return {
    ...(ceilings.maxTurns == null ? {} : { maxTurns: ceilings.maxTurns }),
    ...(remainingCostUsd == null ? {} : { maxBudgetUsd: remainingCostUsd }),
  }
}

export function applyAttemptResourceCeilings(
  result: HarnessSessionResult,
  input: AttemptResourceCeilingSettings | null | undefined,
  options: { cumulativeCostUsd?: number | null; model?: string | null } = {},
): { result: HarnessSessionResult; hit: AttemptResourceCeilingHit | null } {
  const ceilings = resolveAttemptResourceCeilings(input, options)
  if (ceilings == null) return { result, hit: null }
  const turnInput = nonNegative(result.maxInputTokensInTurn)
  const overflow = providerPromptOverflow(result)
  if (overflow && ceilings.maxInputTokensPerTurn != null) {
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

function remainingCeilingBudget(ceiling: number | null | undefined, cumulativeCostUsd: number | null | undefined): number | undefined {
  if (ceiling == null) return undefined
  const spent = nonNegative(cumulativeCostUsd) ?? 0
  return Math.max(0, ceiling - spent)
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
    observedTelemetry: ceilingTelemetry(result),
  }
}

function formatCeilingDetail(ceiling: keyof AttemptResourceCeilings, observed: number, cap: number): string {
  if (ceiling === 'maxCumulativeCostUsd') return `attempt cumulative cost ${formatUsd(observed)} exceeded cap ${formatUsd(cap)}`
  if (ceiling === 'maxTurns') return `attempt turns ${observed} exceeded cap ${cap}`
  return `attempt input tokens per turn ${observed} exceeded cap ${cap}`
}

function normalizeCeilingValue(
  input: AttemptResourceCeilingSettings,
  key: keyof AttemptResourceCeilings,
  context: AttemptResourceCeilingContext,
): number | null {
  if (Object.prototype.hasOwnProperty.call(input, key)) return positive(input[key])
  if (key === 'maxInputTokensPerTurn') return defaultMaxInputTokensPerTurnForModel(context.model)
  return DEFAULT_ATTEMPT_RESOURCE_CEILINGS[key]
}

function providerPromptOverflow(result: HarnessSessionResult): boolean {
  const reason = result.failReason ?? ''
  if (result.exitReason !== 'failed') return false
  return /prompt[_ -]?overflow/i.test(reason) || promptOverflowEvidence(result.failureEvidence)
}

function promptOverflowEvidence(evidence: unknown): boolean {
  return promptOverflowEvidenceValue(evidence, 0)
}

function promptOverflowEvidenceValue(value: unknown, depth: number): boolean {
  if (depth > 4 || value == null) return false
  if (typeof value === 'string') return /prompt[_ -]?overflow|prompt is too long/i.test(value)
  if (Array.isArray(value)) return value.some((item) => promptOverflowEvidenceValue(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.values(value).some((item) => promptOverflowEvidenceValue(item, depth + 1))
}

function ceilingTelemetry(result: HarnessSessionResult): AttemptResourceCeilingTelemetry {
  return {
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    turns: nonNegative(result.turns),
    maxInputTokensInTurn: nonNegative(result.maxInputTokensInTurn),
    ...(result.failReason == null ? {} : { failReason: result.failReason }),
  }
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
