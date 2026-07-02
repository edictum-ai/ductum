import type { ApiContext } from './deps.js'
import type { FactoryAnalyticsReport } from './factory-analytics-types.js'
import {
  parseAnalyticsRange,
  previousAnalyticsWindow,
} from './factory-analytics-window.js'
import { buildBudgetBurndown } from './factory-analytics-budget.js'
import { buildCleanDoneIndex } from './factory-analytics-clean.js'
import {
  buildAgentBreakdown,
  buildMissingUsageFilter,
  buildModelBreakdown,
  buildTrendSeries,
} from './factory-analytics-breakdown.js'
import { buildCoverageLabel, buildHeadline } from './factory-analytics-headline.js'

export interface BuildAnalyticsInput {
  range?: string
  from?: string
  to?: string
  /** Filter to a specific coverage kind. Default `any_gap`. */
  missingUsageFilter?: 'usage_missing' | 'price_missing' | 'any_gap'
}

/**
 * Server-authoritative analytics report for issue #218. Attempt/status/cost
 * counts are SQL-derived, and clean-done counts use execution integrity; we
 * never re-derive user-facing counts from capped list endpoints (AGENTS.md
 * rule, issue #203 regression guard).
 */
export function buildFactoryAnalyticsReport(
  context: ApiContext,
  input: BuildAnalyticsInput = {},
): FactoryAnalyticsReport {
  const now = context.now()
  const window = parseAnalyticsRange(now, {
    range: input.range,
    from: input.from,
    to: input.to,
  })

  const cleanDone = buildCleanDoneIndex(context, window)
  const headline = buildHeadline(context, window, cleanDone)
  const previousWindow = previousAnalyticsWindow(window)
  const previousHeadline = previousWindow == null
    ? null
    : buildHeadline(context, previousWindow, buildCleanDoneIndex(context, previousWindow))
  const trends = buildTrendSeries(context, window, cleanDone)
  const perAgent = buildAgentBreakdown(context, window, cleanDone)
  const perModel = buildModelBreakdown(context, window, cleanDone)
  const missingUsage = buildMissingUsageFilter(context, window, input.missingUsageFilter ?? 'any_gap')
  const budget = buildBudgetBurndown(context, window.from, window.to, {
    perSpecHardUsd: context.costBudget.perSpecHardUsd,
  })

  return {
    generatedAt: now.toISOString(),
    range: window,
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount: headline.attemptCount,
      coverageLabel: buildCoverageLabel(window, headline),
    },
    headline,
    previousHeadline,
    trends,
    perAgent,
    perModel,
    budget,
    missingUsage,
    statusCounts: headline.statusCounts,
  }
}
