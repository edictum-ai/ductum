import type { ApiContext } from './deps.js'
import type { AnalyticsBudgetBurndown, AnalyticsBudgetRow } from './factory-analytics-types.js'
import { windowWhere } from './factory-analytics-sql.js'
import { formatCost, roundCents } from './factory-analytics-cost.js'

const DEFAULT_TOP_SPECS = 8

interface SpecSpendDayRow {
  spec_id: string
  spec_name: string | null
  project_name: string | null
  day: string
  spent_usd: number
  attempt_count: number
}

interface SpecSpendRollupRow {
  spec_id: string
  spec_name: string | null
  project_name: string | null
  spent_usd: number
  attempt_count: number
}

/**
 * Per-spec budget burn-down. Spend is server-aggregated from the runs
 * table — never derived from a capped list (AGENTS.md rule).
 *
 * The cap is the configured `perSpecHardUsd`. When unset, we still report
 * spend but mark `capUsd: null` so the dashboard can render "no cap
 * configured" instead of inventing one.
 */
export function buildBudgetBurndown(
  context: ApiContext,
  from: string | null,
  to: string,
  options: { perSpecHardUsd?: number; topSpecs?: number } = {},
): AnalyticsBudgetBurndown | null {
  const where = windowWhere(from, to)
  const dayRows = readSpecSpendByDay(context, where.sql, where.params)
  const rollups = readSpecSpendRollup(context, where.sql, where.params)

  const perSpecCap = options.perSpecHardUsd ?? null
  const aggregateCap = perSpecCap == null ? null : perSpecCap * rollups.length
  const totalSpent = roundCents(rollups.reduce((sum, row) => sum + row.spent_usd, 0))
  const remaining = aggregateCap == null ? null : Math.max(0, aggregateCap - totalSpent)
  const burnPct = aggregateCap == null ? null : aggregateCap > 0 ? Math.min(1, totalSpent / aggregateCap) : null

  const topN = options.topSpecs ?? DEFAULT_TOP_SPECS
  const topSpecIds = new Set(
    rollups
      .slice()
      .sort((a, b) => b.spent_usd - a.spent_usd)
      .slice(0, topN)
      .map((row) => row.spec_id),
  )

  const series = buildFactoryDailyCumulative(dayRows)
  const bySpec = rollups
    .filter((row) => topSpecIds.has(row.spec_id))
    .map((row) => buildBudgetRow(row, perSpecCap))

  return {
    capUsd: aggregateCap,
    spentUsd: totalSpent,
    remainingUsd: remaining == null ? null : roundCents(remaining),
    burnPctLabel: budgetLabel(perSpecCap, rollups.length, burnPct),
    burnPct,
    series,
    bySpec,
  }
}

function budgetLabel(perSpecCap: number | null, activeSpecs: number, burnPct: number | null): string {
  if (perSpecCap == null) return 'no cap configured'
  if (activeSpecs === 0) return 'no active specs'
  return burnPct == null ? 'no usable cap' : `${Math.round(burnPct * 100)}% burned`
}

function buildBudgetRow(row: SpecSpendRollupRow, cap: number | null): AnalyticsBudgetRow {
  const spent = roundCents(row.spent_usd)
  if (cap == null) {
    return {
      specId: row.spec_id,
      specName: row.spec_name ?? row.spec_id,
      projectName: row.project_name ?? '—',
      capUsd: null,
      spentUsd: spent,
      remainingUsd: null,
      burnPctLabel: `${formatCost(spent)} tracked · no cap`,
      burnPct: null,
      attemptCount: row.attempt_count,
    }
  }
  const remaining = Math.max(0, cap - spent)
  const burnPct = cap > 0 ? Math.min(1, spent / cap) : null
  return {
    specId: row.spec_id,
    specName: row.spec_name ?? row.spec_id,
    projectName: row.project_name ?? '—',
    capUsd: cap,
    spentUsd: spent,
    remainingUsd: roundCents(remaining),
    burnPctLabel: burnPct == null
      ? `${formatCost(spent)} of ${formatCost(cap)}`
      : `${formatCost(spent)} of ${formatCost(cap)} (${Math.round(burnPct * 100)}%)`,
    burnPct,
    attemptCount: row.attempt_count,
  }
}

function buildFactoryDailyCumulative(rows: SpecSpendDayRow[]): Array<{ day: string; cumulativeUsd: number; spentUsd: number }> {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.spent_usd)
  }
  const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
  let cumulative = 0
  return sorted.map(([day, spent]) => {
    cumulative += spent
    return { day, cumulativeUsd: roundCents(cumulative), spentUsd: roundCents(spent) }
  })
}

function readSpecSpendByDay(
  context: ApiContext,
  whereSql: string,
  params: unknown[],
): SpecSpendDayRow[] {
  return context.db
    .prepare(
      `
        SELECT
          tasks.spec_id AS spec_id,
          specs.name AS spec_name,
          projects.name AS project_name,
          strftime('%Y-%m-%d', runs.created_at) AS day,
          SUM(CASE WHEN runs.cost_usd > 0 THEN runs.cost_usd ELSE 0 END) AS spent_usd,
          COUNT(*) AS attempt_count
        FROM runs
        JOIN tasks ON tasks.id = runs.task_id
        LEFT JOIN specs ON specs.id = tasks.spec_id
        LEFT JOIN projects ON projects.id = specs.project_id
        WHERE ${whereSql} AND tasks.spec_id IS NOT NULL
        GROUP BY spec_id, day
        ORDER BY spec_id, day
      `,
    )
    .all(...params) as SpecSpendDayRow[]
}

function readSpecSpendRollup(
  context: ApiContext,
  whereSql: string,
  params: unknown[],
): SpecSpendRollupRow[] {
  return context.db
    .prepare(
      `
        SELECT
          tasks.spec_id AS spec_id,
          specs.name AS spec_name,
          projects.name AS project_name,
          SUM(CASE WHEN runs.cost_usd > 0 THEN runs.cost_usd ELSE 0 END) AS spent_usd,
          COUNT(*) AS attempt_count
        FROM runs
        JOIN tasks ON tasks.id = runs.task_id
        LEFT JOIN specs ON specs.id = tasks.spec_id
        LEFT JOIN projects ON projects.id = specs.project_id
        WHERE ${whereSql} AND tasks.spec_id IS NOT NULL
        GROUP BY spec_id
        ORDER BY spent_usd DESC, attempt_count DESC
      `,
    )
    .all(...params) as SpecSpendRollupRow[]
}
