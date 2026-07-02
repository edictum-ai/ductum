import type {
  AnalyticsCostSummary,
  AnalyticsCoverageKind,
} from './factory-analytics-types.js'

export interface CostInput {
  total: number
  trackedUsd: number
  measured: number
  pending: number
  missingPrice: number
  missingUsage: number
}

export function emptyCostInput(): CostInput {
  return { total: 0, trackedUsd: 0, measured: 0, pending: 0, missingPrice: 0, missingUsage: 0 }
}

export function buildCostSummary(input: CostInput): AnalyticsCostSummary {
  const hasGap = input.missingUsage > 0 || input.missingPrice > 0
  return {
    trackedUsd: roundCents(input.trackedUsd),
    measured: input.measured,
    pending: input.pending,
    missingPrice: input.missingPrice,
    missingUsage: input.missingUsage,
    total: input.total,
    valueLabel: costValueLabel(input),
    issueLabel: costIssueLabel(input),
    dominantCoverage: dominantCoverage(input),
    hasGap,
  }
}

export function dominantCoverage(input: CostInput): AnalyticsCoverageKind {
  if (input.missingUsage > 0) return 'usage_missing'
  if (input.missingPrice > 0) return 'price_missing'
  if (input.pending > 0) return 'pending'
  if (input.measured > 0) return 'known'
  return 'none'
}

export function costValueLabel(input: CostInput): string {
  if (input.trackedUsd > 0) return formatCost(input.trackedUsd)
  if (input.pending > 0) return 'pending'
  if (input.missingUsage > 0) return 'usage missing'
  if (input.missingPrice > 0) return 'price missing'
  return formatCost(0)
}

export function costIssueLabel(input: CostInput): string {
  return [
    input.missingUsage > 0 ? countLabel(input.missingUsage, 'missing usage') : null,
    input.missingPrice > 0 ? countLabel(input.missingPrice, 'missing price') : null,
    input.pending > 0 ? countLabel(input.pending, 'pending') : null,
  ].filter(Boolean).join(' · ')
}

/**
 * Three distinct copy strings so the dashboard can label coverage gaps
 * truthfully (issue #218). The dashboard MUST NOT collapse these into a
 * single "incomplete" string.
 */
export function coverageCopy(input: CostInput): {
  knownSpendLabel: string
  usageMissingLabel: string
  priceMissingLabel: string
} {
  return {
    knownSpendLabel: input.trackedUsd > 0
      ? `${formatCost(input.trackedUsd)} tracked across ${input.measured} attempt${plural(input.measured)}`
      : 'no tracked spend',
    usageMissingLabel: input.missingUsage > 0
      ? `${input.missingUsage} attempt${plural(input.missingUsage)} missing usage`
      : 'no attempts missing usage',
    priceMissingLabel: input.missingPrice > 0
      ? `${input.missingPrice} attempt${plural(input.missingPrice)} missing price (tokens recorded)`
      : 'no attempts missing price',
  }
}

export function formatCost(usd: number): string {
  if (usd < 0.01 && usd > 0) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function roundCents(usd: number): number {
  return Math.round(usd * 100) / 100
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
