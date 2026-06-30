import type { RunUiContract } from '@/api/client'
import { runCost, type CostPresentation } from '@/lib/run-presentation'
import { formatCost } from '@/lib/utils'

type CostRun = {
  stage: string
  terminalState: string | null
  costUsd: number
  tokensIn: number
  tokensOut: number
  ui?: RunUiContract
}

export interface CostCoverage {
  trackedUsd: number
  measured: number
  pending: number
  missingPrice: number
  missingUsage: number
  total: number
}

export function summarizeCostCoverage(runs: readonly CostRun[]): CostCoverage {
  const coverage: CostCoverage = {
    trackedUsd: 0,
    measured: 0,
    pending: 0,
    missingPrice: 0,
    missingUsage: 0,
    total: runs.length,
  }
  for (const run of runs) {
    const cost = runCost(run)
    coverage.trackedUsd += cost.usd
    if (cost.state === 'measured') coverage.measured += 1
    else if (cost.state === 'pending') coverage.pending += 1
    else if (cost.state === 'unpriced') coverage.missingPrice += 1
    else coverage.missingUsage += 1
  }
  return coverage
}

export function costCoverageValue(coverage: CostCoverage): string {
  if (coverage.trackedUsd > 0) return formatCost(coverage.trackedUsd)
  if (coverage.pending > 0) return 'pending'
  if (hasCostGap(coverage)) return 'unknown'
  return formatCost(0)
}

export function trackedSpendLabel(coverage: CostCoverage): string {
  return `Tracked ${formatCost(coverage.trackedUsd)}`
}

export function costCoverageIssues(coverage: CostCoverage): string {
  return [
    coverage.missingUsage > 0 ? missingCostLabel(coverage.missingUsage, 'usage') : null,
    coverage.missingPrice > 0 ? missingCostLabel(coverage.missingPrice, 'price') : null,
    coverage.pending > 0 ? countLabel(coverage.pending, 'pending') : null,
  ].filter(Boolean).join(' · ')
}

export function costCoverageRollup(coverage: CostCoverage): string {
  const issues = costCoverageIssues(coverage)
  if (coverage.trackedUsd > 0) {
    return issues.length > 0 ? `${trackedSpendLabel(coverage)} · ${issues}` : trackedSpendLabel(coverage)
  }
  if (issues.length > 0) return `Cost ${costCoverageValue(coverage)} · ${issues}`
  return trackedSpendLabel(coverage)
}

export function costCoverageSource(coverage: CostCoverage, measuredTokens: number): string {
  return [
    measuredTokens > 0 ? `${formatCompactCount(measuredTokens)} measured tokens` : null,
    coverage.missingUsage > 0 ? missingCostLabel(coverage.missingUsage, 'usage') : null,
    coverage.missingPrice > 0 ? missingCostLabel(coverage.missingPrice, 'price') : null,
    coverage.pending > 0 ? countLabel(coverage.pending, 'pending attempt') : null,
  ].filter(Boolean).join(' · ')
}

export function readableCostLabel(cost: CostPresentation): string {
  if (cost.state === 'unmeasured') return 'missing usage'
  if (cost.state === 'unpriced') return 'missing price'
  return cost.label
}

export function hasCostGap(coverage: CostCoverage): boolean {
  return coverage.missingUsage > 0 || coverage.missingPrice > 0
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function missingCostLabel(count: number, kind: 'usage' | 'price'): string {
  return `${count} attempt${count === 1 ? '' : 's'} missing ${kind}`
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}
