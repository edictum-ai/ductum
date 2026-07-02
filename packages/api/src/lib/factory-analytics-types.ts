/**
 * Server-authoritative analytics contract for issue #218.
 *
 * The dashboard date-range selector reads this single endpoint so PM and
 * AI-engineering personas can report trends, model/agent effectiveness,
 * missing usage coverage, and budget burn-down without falling back to ad
 * hoc CLI queries. Attempt/status/cost counts come from SQL aggregates,
 * and clean-done counts use the same execution-integrity rule as Home;
 * we never derive user-facing counts from capped list endpoints
 * (AGENTS.md rule).
 *
 * Coverage is labeled explicitly so the dashboard can distinguish known
 * spend, usage missing, and price missing instead of pretending unpriced
 * attempts were free (issue #203 regression guard).
 */

import type { DisplayStatus } from '@ductum/core'

export type AnalyticsRangeKind = '7d' | '30d' | '90d' | 'all' | 'custom'
export type AnalyticsBucketKind = 'day' | 'week' | 'month'

export interface AnalyticsRangeWindow {
  kind: AnalyticsRangeKind
  /** Stable label such as "Last 7 days" rendered in dashboard headlines. */
  label: string
  /** Inclusive lower bound (ISO). Null means "since the first attempt". */
  from: string | null
  /** Exclusive upper bound (ISO). Always the request time, never null. */
  to: string
  /** Number of calendar days the window covers; null for `all`. */
  days: number | null
  /** Bucket granularity the server chose for trend rendering. */
  bucket: AnalyticsBucketKind
}

export interface AnalyticsCostSummary {
  trackedUsd: number
  measured: number
  pending: number
  missingPrice: number
  missingUsage: number
  total: number
  /** Human label for the headline value (e.g. `$12.40`, `unknown`). */
  valueLabel: string
  /** Compact caveat label listing every coverage gap. */
  issueLabel: string
  /** One of: 'known' | 'usage_missing' | 'price_missing' | 'pending' | 'none'. */
  dominantCoverage: AnalyticsCoverageKind
  hasGap: boolean
}

export type AnalyticsCoverageKind = 'known' | 'usage_missing' | 'price_missing' | 'pending' | 'none'

export interface AnalyticsHeadline {
  attemptCount: number
  statusCounts: Record<DisplayStatus, number>
  cleanDone: number
  cleanDoneRateLabel: string
  cleanDoneRatePct: number | null
  attention: number
  stalledOrFailed: number
  tokensOut: number
  cost: AnalyticsCostSummary
  costPerCleanDoneUsd: number | null
  costPerCleanDoneLabel: string
  reviewPasses: number
  reviewFailures: number
  verificationFailures: number
}

export interface AnalyticsBucket {
  bucketStart: string
  bucketEnd: string
  bucketLabel: string
  attempts: number
  cleanDone: number
  spendUsd: number
  stalls: number
  failures: number
  missingUsage: number
  missingPrice: number
}

export interface AnalyticsTrendSeries {
  kind: AnalyticsBucketKind
  buckets: AnalyticsBucket[]
  spendTotalUsd: number
  attemptsTotal: number
  cleanDoneTotal: number
  stallsTotal: number
  failuresTotal: number
  missingUsageTotal: number
  missingPriceTotal: number
}

export type AnalyticsBreakdownKey = 'agent' | 'model'

export interface AnalyticsBreakdownRow {
  key: string
  label: string
  secondaryLabel: string | null
  attemptCount: number
  doneCount: number
  cleanDone: number
  successRateLabel: string
  successRatePct: number | null
  costTrackedUsd: number
  costPerCleanDoneUsd: number | null
  costPerCleanDoneLabel: string
  reviewPasses: number
  reviewFailures: number
  verificationFailures: number
  missingUsage: number
  missingPrice: number
}

export interface AnalyticsBudgetRow {
  specId: string
  specName: string
  projectName: string
  capUsd: number | null
  spentUsd: number
  remainingUsd: number | null
  burnPctLabel: string
  burnPct: number | null
  attemptCount: number
}

export interface AnalyticsBudgetBurndown {
  capUsd: number | null
  spentUsd: number
  remainingUsd: number | null
  burnPctLabel: string
  burnPct: number | null
  /** Daily cumulative spend for the chart, server-bucketed. */
  series: Array<{ day: string; cumulativeUsd: number; spentUsd: number }>
  bySpec: AnalyticsBudgetRow[]
}

export interface AnalyticsMissingUsageAttempt {
  id: string
  taskName: string
  specName: string
  projectName: string
  agentName: string
  agentModel: string | null
  stage: string
  terminalState: string | null
  createdAt: string
  coverageKind: AnalyticsCoverageKind
}

export interface AnalyticsMissingUsageFilter {
  /** Server-authoritative count; the rows list is a capped sample. */
  totalAttempts: number
  coverageKind: 'usage_missing' | 'price_missing' | 'any_gap'
  rows: AnalyticsMissingUsageAttempt[]
  rowsCapped: boolean
  rowsCap: number
}

export interface FactoryAnalyticsReport {
  generatedAt: string
  range: AnalyticsRangeWindow
  source: {
    kind: 'all_runs'
    label: string
    capped: false
    attemptCount: number
    /** Prose describing what SQL covered, rendered under headlines. */
    coverageLabel: string
  }
  headline: AnalyticsHeadline
  previousHeadline: AnalyticsHeadline | null
  trends: AnalyticsTrendSeries
  perAgent: AnalyticsBreakdownRow[]
  perModel: AnalyticsBreakdownRow[]
  budget: AnalyticsBudgetBurndown | null
  missingUsage: AnalyticsMissingUsageFilter
  /** Per-status factory-wide counts for the window (SQL-derived). */
  statusCounts: Record<DisplayStatus, number>
}

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRangeKind, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All attempts',
  custom: 'Custom range',
}

export const ANALYTICS_DEFAULT_RANGE: AnalyticsRangeKind = '7d'

export const ANALYTICS_MISSING_USAGE_ROW_CAP = 100
