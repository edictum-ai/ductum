import type { DisplayStatus } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { coverageKindCaseSql, coverageReasonCaseSql } from './factory-analytics-coverage.js'

/**
 * Shared SQL fragments for analytics. Every count uses `COUNT(*)` or
 * `SUM(CASE WHEN ...)`. The dashboard must never re-derive user-facing
 * counts from capped list endpoints (AGENTS.md rule).
 */

export interface WindowWhereClause {
  sql: string
  params: unknown[]
}

/** Build a `WHERE` fragment scoping runs to [from, to). `from = null` means since-first-attempt. */
export function windowWhere(from: string | null, to: string): WindowWhereClause {
  const conditions: string[] = []
  const params: unknown[] = []
  if (from != null) {
    conditions.push('datetime(runs.created_at) >= datetime(?)')
    params.push(from)
  }
  conditions.push('datetime(runs.created_at) < datetime(?)')
  params.push(to)
  return { sql: conditions.join(' AND '), params }
}

/** Same display-status CASE expression as the activity summary (#203). */
export function statusCaseSql(): string {
  return `
    CASE
      WHEN terminal_state = 'quarantined' THEN 'quarantined'
      WHEN terminal_state = 'failed' THEN 'failed'
      WHEN terminal_state = 'stalled' THEN 'stalled'
      WHEN terminal_state = 'frozen' THEN 'frozen'
      WHEN terminal_state = 'paused' THEN 'paused'
      WHEN terminal_state = 'cancelled' THEN 'cancelled'
      WHEN stage = 'done' THEN 'done'
      WHEN stage = 'ship' AND pending_approval = 1 THEN 'awaiting_approval'
      WHEN completion_summary IS NOT NULL AND TRIM(completion_summary) != '' THEN 'awaiting_review'
      ELSE 'running'
    END
  `
}

export interface WindowAggregateRow {
  status: DisplayStatus
  attempt_count: number
  tokens_out: number
  tracked_usd: number
  measured: number
  pending: number
  missing_price: number
  missing_usage: number
  review_passes: number
  review_failures: number
  verification_failures: number
  done_count: number
}

export function readWindowRows(
  context: ApiContext,
  from: string | null,
  to: string,
): WindowAggregateRow[] {
  const where = windowWhere(from, to)
  return context.db
    .prepare(
      `
        SELECT
          ${statusCaseSql()} AS status,
          COUNT(*) AS attempt_count,
          COALESCE(SUM(tokens_out), 0) AS tokens_out,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) AS tracked_usd,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END), 0) AS measured,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND (tokens_in > 0 OR tokens_out > 0) THEN 1 ELSE 0 END), 0) AS missing_price,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND terminal_state IS NULL AND stage != 'done' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND NOT (terminal_state IS NULL AND stage != 'done') THEN 1 ELSE 0 END), 0) AS missing_usage,
          COALESCE(SUM(CASE WHEN review_status = 'pass' THEN 1 ELSE 0 END), 0) AS review_passes,
          COALESCE(SUM(CASE WHEN review_status = 'fail' THEN 1 ELSE 0 END), 0) AS review_failures,
          COALESCE(SUM(CASE WHEN ci_status = 'fail' THEN 1 ELSE 0 END), 0) AS verification_failures,
          COALESCE(SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END), 0) AS done_count
        FROM runs
        WHERE ${where.sql}
        GROUP BY status
      `,
    )
    .all(...where.params) as WindowAggregateRow[]
}

export interface BreakdownRow {
  key: string
  label: string
  secondary_label: string | null
  attempt_count: number
  done_count: number
  tracked_usd: number
  measured: number
  missing_price: number
  missing_usage: number
  pending: number
  review_passes: number
  review_failures: number
  verification_failures: number
}

export interface BreakdownQuery {
  /** SELECT expression that yields the group key (e.g. agent_id or model). */
  groupExpression: string
  /** Optional JOIN clause (e.g. `LEFT JOIN agents a ON a.id = runs.agent_id`). */
  join?: string
  /** SELECT expression that yields the display label. */
  labelExpression: string
  /** Optional SELECT expression yielding a secondary label (model name). */
  secondaryLabelExpression?: string | null
}

export function readBreakdownRows(
  context: ApiContext,
  from: string | null,
  to: string,
  query: BreakdownQuery,
): BreakdownRow[] {
  const where = windowWhere(from, to)
  const secondary = query.secondaryLabelExpression != null
    ? `, ${query.secondaryLabelExpression} AS secondary_label`
    : ''
  return context.db
    .prepare(
      `
        SELECT
          ${query.groupExpression} AS key,
          ${query.labelExpression} AS label${secondary},
          COUNT(*) AS attempt_count,
          COALESCE(SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END), 0) AS done_count,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) AS tracked_usd,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END), 0) AS measured,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND (tokens_in > 0 OR tokens_out > 0) THEN 1 ELSE 0 END), 0) AS missing_price,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND terminal_state IS NULL AND stage != 'done' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND NOT (terminal_state IS NULL AND stage != 'done') THEN 1 ELSE 0 END), 0) AS missing_usage,
          COALESCE(SUM(CASE WHEN review_status = 'pass' THEN 1 ELSE 0 END), 0) AS review_passes,
          COALESCE(SUM(CASE WHEN review_status = 'fail' THEN 1 ELSE 0 END), 0) AS review_failures,
          COALESCE(SUM(CASE WHEN ci_status = 'fail' THEN 1 ELSE 0 END), 0) AS verification_failures
        FROM runs
        ${query.join ?? ''}
        WHERE ${where.sql}
        GROUP BY key
        ORDER BY tracked_usd DESC, attempt_count DESC
      `,
    )
    .all(...where.params) as BreakdownRow[]
}

export interface BucketRow {
  bucket_key: string
  attempt_count: number
  tracked_usd: number
  measured: number
  missing_price: number
  missing_usage: number
  pending: number
  stalls: number
  failures: number
  done_count: number
}

export function readBucketRows(
  context: ApiContext,
  from: string | null,
  to: string,
  bucketGroupSql: string,
): BucketRow[] {
  const where = windowWhere(from, to)
  return context.db
    .prepare(
      `
        SELECT
          ${bucketGroupSql} AS bucket_key,
          COUNT(*) AS attempt_count,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) AS tracked_usd,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END), 0) AS measured,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND (tokens_in > 0 OR tokens_out > 0) THEN 1 ELSE 0 END), 0) AS missing_price,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND terminal_state IS NULL AND stage != 'done' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND NOT (terminal_state IS NULL AND stage != 'done') THEN 1 ELSE 0 END), 0) AS missing_usage,
          COALESCE(SUM(CASE WHEN terminal_state = 'stalled' THEN 1 ELSE 0 END), 0) AS stalls,
          COALESCE(SUM(CASE WHEN terminal_state = 'failed' THEN 1 ELSE 0 END), 0) AS failures,
          COALESCE(SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END), 0) AS done_count
        FROM runs
        WHERE ${where.sql}
        GROUP BY bucket_key
        ORDER BY bucket_key ASC
      `,
    )
    .all(...where.params) as BucketRow[]
}

export interface MissingUsageRow {
  id: string
  task_id: string
  spec_id: string
  project_id: string
  agent_id: string
  agent_name: string | null
  agent_model: string | null
  task_name: string | null
  spec_name: string | null
  project_name: string | null
  stage: string
  terminal_state: string | null
  created_at: string
  coverage_kind: 'usage_missing' | 'price_missing'
  coverage_reason: 'operator_recorded' | 'scanner_missing' | 'price_missing'
}

export interface MissingUsageReasonCounts {
  operatorRecorded: number
  scannerMissing: number
  priceMissing: number
}

export function readMissingUsageRows(
  context: ApiContext,
  from: string | null,
  to: string,
  filter: 'usage_missing' | 'price_missing' | 'any_gap',
  limit: number,
): { rows: MissingUsageRow[]; totalAttempts: number; reasonCounts: MissingUsageReasonCounts } {
  const where = windowWhere(from, to)
  const coverageSql = coverageKindCaseSql()
  const coverageReasonSql = coverageReasonCaseSql()
  const coverageCondition = filter === 'any_gap'
    ? `AND (${coverageSql}) IN ('usage_missing', 'price_missing')`
    : `AND ${coverageSql} = '${filter}'`
  const rows = context.db
    .prepare(
      `
        SELECT
          runs.id AS id,
          runs.task_id AS task_id,
          tasks.spec_id AS spec_id,
          specs.project_id AS project_id,
          runs.agent_id AS agent_id,
          agents.name AS agent_name,
          COALESCE(runs.runtime_model, agents.model) AS agent_model,
          tasks.name AS task_name,
          specs.name AS spec_name,
          projects.name AS project_name,
          runs.stage AS stage,
          runs.terminal_state AS terminal_state,
          runs.created_at AS created_at,
          ${coverageSql} AS coverage_kind,
          ${coverageReasonSql} AS coverage_reason
        FROM runs
        LEFT JOIN agents ON agents.id = runs.agent_id
        LEFT JOIN tasks ON tasks.id = runs.task_id
        LEFT JOIN specs ON specs.id = tasks.spec_id
        LEFT JOIN projects ON projects.id = specs.project_id
        WHERE ${where.sql} ${coverageCondition}
        ORDER BY runs.created_at DESC
        LIMIT ?
      `,
    )
    .all(...where.params, limit) as MissingUsageRow[]

  const countRow = (
    context.db
      .prepare(
        `SELECT
           COUNT(*) AS total_attempts,
           COALESCE(SUM(CASE WHEN (${coverageReasonSql}) = 'operator_recorded' THEN 1 ELSE 0 END), 0) AS operator_recorded,
           COALESCE(SUM(CASE WHEN (${coverageReasonSql}) = 'scanner_missing' THEN 1 ELSE 0 END), 0) AS scanner_missing,
           COALESCE(SUM(CASE WHEN (${coverageReasonSql}) = 'price_missing' THEN 1 ELSE 0 END), 0) AS price_missing
         FROM runs
         LEFT JOIN agents ON agents.id = runs.agent_id
         WHERE ${where.sql} ${coverageCondition}`,
      )
      .get(...where.params) as {
        total_attempts: number
        operator_recorded: number
        scanner_missing: number
        price_missing: number
      }
  )

  return {
    rows,
    totalAttempts: countRow.total_attempts,
    reasonCounts: {
      operatorRecorded: countRow.operator_recorded,
      scannerMissing: countRow.scanner_missing,
      priceMissing: countRow.price_missing,
    },
  }
}
