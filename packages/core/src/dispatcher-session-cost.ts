import { computeCost } from './model-pricing.js'
import type { HarnessSessionResult } from './dispatcher-support.js'
import type { ActiveDispatchSession } from './dispatcher-types.js'
import type { EvidenceRepo, RunRepo } from './repos/interfaces.js'
import type { FencingToken } from './attempt-lease.js'
import { createId, type Agent, type Run, type RunId } from './types.js'

/** Provider-side absolute usage snapshot from the local cost scanner. */
export interface SessionCostSnapshot {
  inputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  outputTokens: number
  costUsd: number
}

export interface RecordSessionCostDeps {
  runRepo: RunRepo
  evidenceRepo?: EvidenceRepo
  resolveScannerSnapshot: (runId: RunId) => SessionCostSnapshot | null
  resolveRuntimeAgentForRun: (run: Run) => Agent | null
}

export interface SessionCostForCeiling {
  cumulativeCostUsd: number
  source: 'scanner' | 'runtime' | 'computed' | 'none'
}

export function resolveSessionCostForCeiling(
  deps: Omit<RecordSessionCostDeps, 'runRepo' | 'evidenceRepo'>,
  runId: RunId,
  current: Run,
  result: HarnessSessionResult,
  active: ActiveDispatchSession | null,
): SessionCostForCeiling {
  const scannerSnapshot = deps.resolveScannerSnapshot(runId)
  const agent = active?.agent ?? deps.resolveRuntimeAgentForRun(current)
  if (scannerSnapshot != null) return { cumulativeCostUsd: current.costUsd + scannerSnapshot.costUsd, source: 'scanner' }
  const priced = priceResultDelta(current, result, agent)
  return { cumulativeCostUsd: priced.cumulativeCostUsd, source: priced.source }
}

/** Record provider usage and the accounting evidence for one ended session. */
export function recordSessionCost(
  deps: RecordSessionCostDeps,
  runId: RunId,
  current: Run,
  result: HarnessSessionResult,
  active: ActiveDispatchSession | null,
  fenceToken?: FencingToken,
  fenceNow?: Date,
): void {
  const scannerSnapshot = deps.resolveScannerSnapshot(runId)
  const agent = active?.agent ?? deps.resolveRuntimeAgentForRun(current)
  if (scannerSnapshot != null) {
    const tokensIn = scannerSnapshot.inputTokens + scannerSnapshot.cachedInputTokens + scannerSnapshot.cacheCreationInputTokens
    if (fenceToken != null && deps.runRepo.setTokensFenced != null) {
      deps.runRepo.setTokensFenced(runId, tokensIn, scannerSnapshot.outputTokens, scannerSnapshot.costUsd, fenceToken, fenceNow)
    } else {
      deps.runRepo.setTokens(runId, tokensIn, scannerSnapshot.outputTokens, scannerSnapshot.costUsd)
    }
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result,
      computedCostUsd: computeCost(agent?.model ?? null, Math.max(0, tokensIn - current.tokensIn), Math.max(0, scannerSnapshot.outputTokens - current.tokensOut), agent?.pricing ?? undefined),
      storedCostUsd: scannerSnapshot.costUsd,
      storedTokensIn: tokensIn,
      storedTokensOut: scannerSnapshot.outputTokens,
      source: 'scanner',
      scannerSnapshot,
    }), fenceToken, fenceNow)
    return
  }
  const priced = priceResultDelta(current, result, agent)
  const { tokensIn, tokensOut, computedCostUsd, runtimeCostUsd, useRuntimeCost } = priced
  if (useRuntimeCost && runtimeCostUsd != null) {
    const storedTokensIn = Math.max(current.tokensIn, result.tokensIn)
    const storedTokensOut = Math.max(current.tokensOut, result.tokensOut)
    const storedCostUsd = priced.cumulativeCostUsd
    if (fenceToken != null && deps.runRepo.setTokensFenced != null) {
      deps.runRepo.setTokensFenced(runId, storedTokensIn, storedTokensOut, storedCostUsd, fenceToken, fenceNow)
    } else {
      deps.runRepo.setTokens(runId, storedTokensIn, storedTokensOut, storedCostUsd)
    }
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result, computedCostUsd, storedCostUsd, storedTokensIn, storedTokensOut, source: 'runtime',
    }), fenceToken, fenceNow)
  } else if (tokensIn > 0 || tokensOut > 0) {
    if (fenceToken != null && deps.runRepo.updateTokensFenced != null) {
      deps.runRepo.updateTokensFenced(runId, tokensIn, tokensOut, computedCostUsd, fenceToken, fenceNow)
    } else {
      deps.runRepo.updateTokens(runId, tokensIn, tokensOut, computedCostUsd)
    }
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result,
      computedCostUsd,
      storedCostUsd: current.costUsd + computedCostUsd,
      storedTokensIn: current.tokensIn + tokensIn,
      storedTokensOut: current.tokensOut + tokensOut,
      source: 'computed',
    }), fenceToken, fenceNow)
  } else {
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result, computedCostUsd, storedCostUsd: current.costUsd, storedTokensIn: current.tokensIn, storedTokensOut: current.tokensOut, source: 'none',
    }), fenceToken, fenceNow)
  }
}

type CostSource = 'scanner' | 'runtime' | 'computed' | 'none'

function priceResultDelta(current: Run, result: HarnessSessionResult, agent: Agent | null): {
  tokensIn: number
  tokensOut: number
  computedCostUsd: number
  runtimeCostUsd: number | null
  useRuntimeCost: boolean
  cumulativeCostUsd: number
  source: CostSource
} {
  const tokensIn = Math.max(0, result.tokensIn - current.tokensIn)
  const tokensOut = Math.max(0, result.tokensOut - current.tokensOut)
  const computedCostUsd = computeCost(agent?.model ?? null, tokensIn, tokensOut, agent?.pricing ?? undefined)
  const runtimeCostUsd = nonNegative(result.costUsd)
  const useRuntimeCost = runtimeCostUsd != null && (runtimeCostUsd > 0 || result.costState === 'measured')
  if (useRuntimeCost) {
    return { tokensIn, tokensOut, computedCostUsd, runtimeCostUsd, useRuntimeCost, cumulativeCostUsd: current.costUsd + runtimeCostUsd, source: 'runtime' }
  }
  if (tokensIn > 0 || tokensOut > 0) {
    return { tokensIn, tokensOut, computedCostUsd, runtimeCostUsd, useRuntimeCost, cumulativeCostUsd: current.costUsd + computedCostUsd, source: 'computed' }
  }
  return { tokensIn, tokensOut, computedCostUsd, runtimeCostUsd, useRuntimeCost, cumulativeCostUsd: current.costUsd, source: 'none' }
}

function accountingPayload(input: {
  result: HarnessSessionResult
  computedCostUsd: number
  storedCostUsd: number
  storedTokensIn: number
  storedTokensOut: number
  source: CostSource
  scannerSnapshot?: SessionCostSnapshot
}) {
  const runtimeReportedCostUsd = nonNegative(input.result.costUsd)
  const mismatch = input.source !== 'runtime' && input.result.costState === 'measured' && runtimeReportedCostUsd != null && Math.abs(runtimeReportedCostUsd - input.storedCostUsd) > 0.000001
  return {
    kind: 'attempt.runtime_accounting',
    schemaVersion: 1,
    source: input.source,
    result: input.result,
    runtimeReportedCostUsd,
    computedCostUsd: input.computedCostUsd,
    storedCostUsd: input.storedCostUsd,
    storedTokensIn: input.storedTokensIn,
    storedTokensOut: input.storedTokensOut,
    ...(input.scannerSnapshot == null ? {} : { scannerSnapshot: input.scannerSnapshot }),
    ...(mismatch ? { mismatch: { kind: 'db_runtime_cost', runtimeReportedCostUsd, storedCostUsd: input.storedCostUsd, differenceUsd: input.storedCostUsd - runtimeReportedCostUsd } } : {}),
  }
}

function recordAccountingEvidence(
  evidenceRepo: EvidenceRepo | undefined,
  runId: RunId,
  payload: ReturnType<typeof accountingPayload>,
  fenceToken?: FencingToken,
  fenceNow?: Date,
): void {
  if (evidenceRepo == null) return
  const evidence = { id: createId<'EvidenceId'>(), runId, type: 'custom', payload } as const
  if (fenceToken != null && evidenceRepo.createFenced != null) evidenceRepo.createFenced(evidence, fenceToken, fenceNow)
  else evidenceRepo.create(evidence)
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
