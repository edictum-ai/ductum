import type { Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { getRunExecutionIntegrityFieldsMap } from './execution-integrity.js'
import type { AnalyticsBucketKind, AnalyticsRangeWindow } from './factory-analytics-types.js'
import { windowWhere } from './factory-analytics-sql.js'
import { bucketSqlExpressions } from './factory-analytics-window.js'

interface DoneRunIndexRow {
  id: string
  agent_id: string
  model_key: string
  created_at: string
}

export interface CleanDoneIndex {
  total: number
  byRunId: Set<string>
  byBucket: Map<string, number>
  byAgent: Map<string, number>
  byModel: Map<string, number>
}

export function buildCleanDoneIndex(context: ApiContext, window: AnalyticsRangeWindow): CleanDoneIndex {
  const rows = readDoneRunIndexRows(context, window)
  const runs = rows
    .map((row) => context.repos.runs.get(row.id as Run['id']))
    .filter((run): run is Run => run != null)
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const integrityByRunId = getRunExecutionIntegrityFieldsMap(context, runs)
  const index = emptyCleanDoneIndex()

  for (const run of runs) {
    const issues = integrityByRunId.get(run.id)?.executionIssues ?? []
    if (issues.length > 0) continue
    const row = rowById.get(run.id)
    if (row == null) continue
    index.total += 1
    index.byRunId.add(run.id)
    increment(index.byAgent, row.agent_id)
    increment(index.byModel, row.model_key)
    increment(index.byBucket, bucketKeyForDate(window.bucket, new Date(run.createdAt)))
  }

  return index
}

function emptyCleanDoneIndex(): CleanDoneIndex {
  return {
    total: 0,
    byRunId: new Set(),
    byBucket: new Map(),
    byAgent: new Map(),
    byModel: new Map(),
  }
}

function readDoneRunIndexRows(context: ApiContext, window: AnalyticsRangeWindow): DoneRunIndexRow[] {
  const where = windowWhere(window.from, window.to)
  return context.db
    .prepare(
      `
        SELECT
          runs.id AS id,
          runs.agent_id AS agent_id,
          COALESCE(NULLIF(runs.runtime_model, ''), agents.model, 'unknown') AS model_key,
          runs.created_at AS created_at
        FROM runs
        LEFT JOIN agents ON agents.id = runs.agent_id
        WHERE ${where.sql} AND runs.stage = 'done'
      `,
    )
    .all(...where.params) as DoneRunIndexRow[]
}

function bucketKeyForDate(kind: AnalyticsBucketKind, date: Date): string {
  const start = bucketSqlExpressions(kind).bucketStart(date)
  if (kind === 'month') {
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const year = start.getUTCFullYear()
  const month = String(start.getUTCMonth() + 1).padStart(2, '0')
  const day = String(start.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}
