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
  measured: boolean
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
  if (scannerSnapshot != null) {
    const priced = priceScannerSnapshot(current, scannerSnapshot, agent, active)
    return { cumulativeCostUsd: priced.cumulativeCostUsd, source: priced.source }
  }
  const priced = priceResultDelta(current, result, agent, active)
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
    const priced = priceScannerSnapshot(current, scannerSnapshot, agent, active)
    const { tokensIn, tokensOut, computedCostUsd, storedCostDeltaUsd, source } = priced
    const storedTokensIn = current.tokensIn + tokensIn
    const storedTokensOut = current.tokensOut + tokensOut
    if (tokensIn > 0 || tokensOut > 0 || storedCostDeltaUsd > 0) {
      if (fenceToken != null && deps.runRepo.updateTokensFenced != null) {
        deps.runRepo.updateTokensFenced(runId, tokensIn, tokensOut, storedCostDeltaUsd, fenceToken, fenceNow)
      } else {
        deps.runRepo.updateTokens(runId, tokensIn, tokensOut, storedCostDeltaUsd)
      }
    } else {
      recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
        result,
        computedCostUsd,
        storedCostUsd: current.costUsd,
        storedTokensIn: current.tokensIn,
        storedTokensOut: current.tokensOut,
        source,
        scannerSnapshot,
      }), fenceToken, fenceNow)
      return
    }
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result,
      computedCostUsd,
      storedCostUsd: current.costUsd + storedCostDeltaUsd,
      storedTokensIn,
      storedTokensOut,
      source,
      scannerSnapshot,
    }), fenceToken, fenceNow)
    return
  }
  const priced = priceResultDelta(current, result, agent, active)
  const { tokensIn, tokensOut, computedCostUsd, computedCostDeltaUsd, runtimeCostUsd, useRuntimeCost } = priced
  if (useRuntimeCost && runtimeCostUsd != null) {
    const storedTokensIn = current.tokensIn + tokensIn
    const storedTokensOut = current.tokensOut + tokensOut
    const storedCostUsd = priced.cumulativeCostUsd
    if (tokensIn > 0 || tokensOut > 0 || runtimeCostUsd > 0) {
      if (fenceToken != null && deps.runRepo.updateTokensFenced != null) {
        deps.runRepo.updateTokensFenced(runId, tokensIn, tokensOut, runtimeCostUsd, fenceToken, fenceNow)
      } else {
        deps.runRepo.updateTokens(runId, tokensIn, tokensOut, runtimeCostUsd)
      }
    }
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result, computedCostUsd, storedCostUsd, storedTokensIn, storedTokensOut, source: 'runtime',
    }), fenceToken, fenceNow)
  } else if (tokensIn > 0 || tokensOut > 0 || computedCostDeltaUsd > 0) {
    if (fenceToken != null && deps.runRepo.updateTokensFenced != null) {
      deps.runRepo.updateTokensFenced(runId, tokensIn, tokensOut, computedCostDeltaUsd, fenceToken, fenceNow)
    } else {
      deps.runRepo.updateTokens(runId, tokensIn, tokensOut, computedCostDeltaUsd)
    }
    recordAccountingEvidence(deps.evidenceRepo, runId, accountingPayload({
      result,
      computedCostUsd,
      storedCostUsd: current.costUsd + computedCostDeltaUsd,
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

function priceResultDelta(current: Run, result: HarnessSessionResult, agent: Agent | null, active: ActiveDispatchSession | null): {
  tokensIn: number
  tokensOut: number
  computedCostUsd: number
  computedCostDeltaUsd: number
  runtimeCostUsd: number | null
  useRuntimeCost: boolean
  cumulativeCostUsd: number
  source: CostSource
} {
  const baseline = sessionBaseline(current, active)
  const absoluteTokensIn = Math.max(0, result.tokensIn)
  const absoluteTokensOut = Math.max(0, result.tokensOut)
  const tokensIn = unrecordedFromAbsolute(absoluteTokensIn, current.tokensIn, baseline.tokensIn)
  const tokensOut = unrecordedFromAbsolute(absoluteTokensOut, current.tokensOut, baseline.tokensOut)
  const computedCostUsd = computeCost(agent?.model ?? null, absoluteTokensIn, absoluteTokensOut, agent?.pricing ?? undefined)
  const computedCostDeltaUsd = unrecordedFromAbsolute(computedCostUsd, current.costUsd, baseline.costUsd)
  const runtimeCostUsd = nonNegative(result.costUsd)
  const useRuntimeCost = runtimeCostUsd != null && (runtimeCostUsd > 0 || result.costState === 'measured')
  if (useRuntimeCost) {
    const runtimeCostDeltaUsd = unrecordedFromAbsolute(runtimeCostUsd, current.costUsd, baseline.costUsd)
    return { tokensIn, tokensOut, computedCostUsd, computedCostDeltaUsd, runtimeCostUsd: runtimeCostDeltaUsd, useRuntimeCost, cumulativeCostUsd: current.costUsd + runtimeCostDeltaUsd, source: 'runtime' }
  }
  if (tokensIn > 0 || tokensOut > 0 || computedCostDeltaUsd > 0) {
    return { tokensIn, tokensOut, computedCostUsd, computedCostDeltaUsd, runtimeCostUsd, useRuntimeCost, cumulativeCostUsd: current.costUsd + computedCostDeltaUsd, source: 'computed' }
  }
  return { tokensIn, tokensOut, computedCostUsd, computedCostDeltaUsd, runtimeCostUsd, useRuntimeCost, cumulativeCostUsd: current.costUsd + computedCostDeltaUsd, source: computedCostDeltaUsd > 0 ? 'computed' : 'none' }
}

function priceScannerSnapshot(current: Run, scannerSnapshot: SessionCostSnapshot, agent: Agent | null, active: ActiveDispatchSession | null): {
  tokensIn: number
  tokensOut: number
  computedCostUsd: number
  storedCostDeltaUsd: number
  cumulativeCostUsd: number
  source: CostSource
} {
  const baseline = sessionBaseline(current, active)
  const absoluteTokensIn = scannerSnapshot.inputTokens + scannerSnapshot.cachedInputTokens + scannerSnapshot.cacheCreationInputTokens
  const absoluteTokensOut = scannerSnapshot.outputTokens
  const tokensIn = unrecordedFromAbsolute(absoluteTokensIn, current.tokensIn, baseline.tokensIn)
  const tokensOut = unrecordedFromAbsolute(absoluteTokensOut, current.tokensOut, baseline.tokensOut)
  const computedCostUsd = computeCost(agent?.model ?? null, absoluteTokensIn, absoluteTokensOut, agent?.pricing ?? undefined)
  const computedCostDeltaUsd = unrecordedFromAbsolute(computedCostUsd, current.costUsd, baseline.costUsd)
  if (scannerSnapshot.measured) {
    const scannerCostDeltaUsd = unrecordedFromAbsolute(scannerSnapshot.costUsd, current.costUsd, baseline.costUsd)
    return {
      tokensIn,
      tokensOut,
      computedCostUsd,
      storedCostDeltaUsd: scannerCostDeltaUsd,
      cumulativeCostUsd: current.costUsd + scannerCostDeltaUsd,
      source: 'scanner',
    }
  }
  if (tokensIn > 0 || tokensOut > 0) {
    return {
      tokensIn,
      tokensOut,
      computedCostUsd,
      storedCostDeltaUsd: computedCostDeltaUsd,
      cumulativeCostUsd: current.costUsd + computedCostDeltaUsd,
      source: 'computed',
    }
  }
  return { tokensIn, tokensOut, computedCostUsd, storedCostDeltaUsd: 0, cumulativeCostUsd: current.costUsd, source: 'none' }
}

function sessionBaseline(current: Run, active: ActiveDispatchSession | null): { tokensIn: number; tokensOut: number; costUsd: number } {
  const currentTokensIn = nonNegative(current.tokensIn) ?? 0
  const currentTokensOut = nonNegative(current.tokensOut) ?? 0
  const currentCostUsd = nonNegative(current.costUsd) ?? 0
  return {
    tokensIn: nonNegative(active?.initialTokensIn) ?? currentTokensIn,
    tokensOut: nonNegative(active?.initialTokensOut) ?? currentTokensOut,
    costUsd: nonNegative(active?.initialCostUsd) ?? currentCostUsd,
  }
}

function unrecordedFromAbsolute(absoluteSessionValue: number, currentRunValue: number, baselineRunValue: number): number {
  const currentValue = nonNegative(currentRunValue) ?? 0
  const baselineValue = nonNegative(baselineRunValue) ?? 0
  const absoluteValue = nonNegative(absoluteSessionValue) ?? 0
  const alreadyRecorded = Math.max(0, currentValue - baselineValue)
  return Math.max(0, absoluteValue - alreadyRecorded)
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
