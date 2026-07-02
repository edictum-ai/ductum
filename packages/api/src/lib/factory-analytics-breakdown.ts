import type { ApiContext } from './deps.js'
import type {
  AnalyticsBreakdownRow,
  AnalyticsBucket,
  AnalyticsMissingUsageAttempt,
  AnalyticsMissingUsageFilter,
  AnalyticsRangeWindow,
  AnalyticsTrendSeries,
} from './factory-analytics-types.js'
import {
  bucketSqlExpressions,
  iterateBuckets,
} from './factory-analytics-window.js'
import {
  readBreakdownRows,
  readBucketRows,
  readMissingUsageRows,
  type BreakdownRow,
  type BucketRow,
} from './factory-analytics-sql.js'
import { buildCostSummary, formatCost, roundCents } from './factory-analytics-cost.js'
import type { CleanDoneIndex } from './factory-analytics-clean.js'
import { ANALYTICS_MISSING_USAGE_ROW_CAP } from './factory-analytics-types.js'

export function buildTrendSeries(
  context: ApiContext,
  window: AnalyticsRangeWindow,
  cleanDoneIndex: CleanDoneIndex,
): AnalyticsTrendSeries {
  const expr = bucketSqlExpressions(window.bucket)
  const rows = readBucketRows(context, window.from, window.to, expr.group)
  const from = window.from == null ? inferEarliestFrom(context, window.to) : new Date(window.from)
  const buckets = composeBuckets(rows, from, new Date(window.to), window.bucket, cleanDoneIndex)

  return {
    kind: window.bucket,
    buckets,
    spendTotalUsd: roundCents(buckets.reduce((s, b) => s + b.spendUsd, 0)),
    attemptsTotal: buckets.reduce((s, b) => s + b.attempts, 0),
    cleanDoneTotal: buckets.reduce((s, b) => s + b.cleanDone, 0),
    stallsTotal: buckets.reduce((s, b) => s + b.stalls, 0),
    failuresTotal: buckets.reduce((s, b) => s + b.failures, 0),
    missingUsageTotal: buckets.reduce((s, b) => s + b.missingUsage, 0),
    missingPriceTotal: buckets.reduce((s, b) => s + b.missingPrice, 0),
  }
}

function inferEarliestFrom(context: ApiContext, to: string): Date {
  const row = context.db
    .prepare('SELECT MIN(created_at) AS first_at FROM runs WHERE datetime(created_at) < datetime(?)')
    .get(to) as { first_at: string | null } | undefined
  const first = row?.first_at
  if (first == null) return new Date(to)
  const parsed = new Date(first)
  return Number.isNaN(parsed.getTime()) ? new Date(to) : parsed
}

function composeBuckets(
  rows: BucketRow[],
  from: Date,
  to: Date,
  kind: AnalyticsRangeWindow['bucket'],
  cleanDoneIndex: CleanDoneIndex,
): AnalyticsBucket[] {
  const expr = bucketSqlExpressions(kind)
  const byKey = new Map<string, BucketRow>()
  for (const row of rows) byKey.set(row.bucket_key, row)

  const boundaries = iterateBuckets(from, to, kind)
  return boundaries.map(({ start, end }) => {
    const key = formatBucketKey(kind, start)
    const row = byKey.get(key)
    const cleanDone = cleanDoneIndex.byBucket.get(key) ?? 0
    return {
      bucketStart: start.toISOString(),
      bucketEnd: end.toISOString(),
      bucketLabel: expr.formatLabel(key),
      attempts: row?.attempt_count ?? 0,
      cleanDone,
      spendUsd: roundCents(row?.tracked_usd ?? 0),
      stalls: row?.stalls ?? 0,
      failures: row?.failures ?? 0,
      missingUsage: row?.missing_usage ?? 0,
      missingPrice: row?.missing_price ?? 0,
    }
  })
}

function formatBucketKey(kind: AnalyticsRangeWindow['bucket'], start: Date): string {
  if (kind === 'month') {
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const year = start.getUTCFullYear()
  const month = String(start.getUTCMonth() + 1).padStart(2, '0')
  const day = String(start.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildAgentBreakdown(
  context: ApiContext,
  window: AnalyticsRangeWindow,
  cleanDoneIndex: CleanDoneIndex,
): AnalyticsBreakdownRow[] {
  const rows = readBreakdownRows(context, window.from, window.to, {
    groupExpression: 'runs.agent_id',
    labelExpression: 'COALESCE(agents.name, runs.agent_id)',
    secondaryLabelExpression: 'COALESCE(runs.runtime_model, agents.model)',
    join: 'LEFT JOIN agents ON agents.id = runs.agent_id',
  })
  return rows.map((row) => toBreakdownRow(row, row.secondary_label, cleanDoneIndex.byAgent.get(row.key) ?? 0))
}

export function buildModelBreakdown(
  context: ApiContext,
  window: AnalyticsRangeWindow,
  cleanDoneIndex: CleanDoneIndex,
): AnalyticsBreakdownRow[] {
  const rows = readBreakdownRows(context, window.from, window.to, {
    groupExpression: `COALESCE(NULLIF(runs.runtime_model, ''), agents.model, 'unknown')`,
    labelExpression: `COALESCE(NULLIF(runs.runtime_model, ''), agents.model, 'unknown')`,
    join: 'LEFT JOIN agents ON agents.id = runs.agent_id',
  })
  return rows.map((row) => toBreakdownRow(row, null, cleanDoneIndex.byModel.get(row.key) ?? 0))
}

function toBreakdownRow(row: BreakdownRow, secondary: string | null, cleanDone: number): AnalyticsBreakdownRow {
  const costInput = {
    total: row.attempt_count,
    trackedUsd: row.tracked_usd,
    measured: row.measured,
    pending: row.pending,
    missingPrice: row.missing_price,
    missingUsage: row.missing_usage,
  }
  const cost = buildCostSummary(costInput)
  const successRatePct = row.attempt_count === 0 ? null : cleanDone / row.attempt_count
  const costPerCleanDoneUsd = cleanDone > 0 ? roundCents(row.tracked_usd / cleanDone) : null
  return {
    key: row.key,
    label: row.label,
    secondaryLabel: secondary,
    attemptCount: row.attempt_count,
    doneCount: row.done_count,
    cleanDone,
    successRateLabel: row.attempt_count === 0 ? 'n/a' : `${Math.round(successRatePct! * 100)}% clean`,
    successRatePct,
    costTrackedUsd: roundCents(row.tracked_usd),
    costPerCleanDoneUsd,
    costPerCleanDoneLabel: costPerCleanDoneUsd == null ? 'n/a' : formatCost(costPerCleanDoneUsd),
    reviewPasses: row.review_passes,
    reviewFailures: row.review_failures,
    verificationFailures: row.verification_failures,
    missingUsage: cost.missingUsage,
    missingPrice: cost.missingPrice,
  }
}

export function buildMissingUsageFilter(
  context: ApiContext,
  window: AnalyticsRangeWindow,
  filter: 'usage_missing' | 'price_missing' | 'any_gap',
): AnalyticsMissingUsageFilter {
  const { rows, totalAttempts } = readMissingUsageRows(
    context,
    window.from,
    window.to,
    filter,
    ANALYTICS_MISSING_USAGE_ROW_CAP + 1,
  )
  const trimmed = rows.slice(0, ANALYTICS_MISSING_USAGE_ROW_CAP)
  const mapped: AnalyticsMissingUsageAttempt[] = trimmed.map((row) => ({
    id: row.id,
    taskName: row.task_name ?? '—',
    specName: row.spec_name ?? '—',
    projectName: row.project_name ?? '—',
    agentName: row.agent_name ?? '—',
    agentModel: row.agent_model,
    stage: row.stage,
    terminalState: row.terminal_state,
    createdAt: row.created_at,
    coverageKind: row.coverage_kind,
  }))
  return {
    totalAttempts,
    coverageKind: filter,
    rows: mapped,
    rowsCapped: rows.length > ANALYTICS_MISSING_USAGE_ROW_CAP,
    rowsCap: ANALYTICS_MISSING_USAGE_ROW_CAP,
  }
}
