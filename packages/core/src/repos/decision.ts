import type { Decision, DecisionId, RunId, SpecId, TaskId } from '../types.js'
import type { DecisionRepo } from './interfaces.js'
import {
  parseOptionalJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface DecisionRow {
  id: DecisionId
  spec_id: string | null
  task_id: string | null
  run_id: string | null
  decision: string
  context: string
  alternatives: string | null
  decided_by: string
  supersedes_id: string | null
  created_at: string
}

function mapDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    specId: row.spec_id as SpecId | null,
    taskId: row.task_id as TaskId | null,
    runId: row.run_id as RunId | null,
    decision: row.decision,
    context: row.context,
    alternatives: parseOptionalJson<string[]>(row.alternatives),
    decidedBy: row.decided_by,
    supersedesId: row.supersedes_id as DecisionId | null,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

export class SqliteDecisionRepo implements DecisionRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(filters: { specId?: SpecId; taskId?: TaskId; runId?: RunId }): Decision[] {
    const clauses: string[] = []
    const values: unknown[] = []

    if (filters.specId != null) {
      clauses.push('spec_id = ?')
      values.push(filters.specId)
    }
    if (filters.taskId != null) {
      clauses.push('task_id = ?')
      values.push(filters.taskId)
    }
    if (filters.runId != null) {
      clauses.push('run_id = ?')
      values.push(filters.runId)
    }

    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    return this.db
      .prepare(`SELECT * FROM decisions ${where} ORDER BY created_at`)
      .all(...values)
      .map((row) => mapDecision(row as DecisionRow))
  }

  create(decision: Omit<Decision, 'createdAt'>): Decision {
    this.db
      .prepare(
        'INSERT INTO decisions (id, spec_id, task_id, run_id, decision, context, alternatives, decided_by, supersedes_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        decision.id,
        decision.specId,
        decision.taskId,
        decision.runId,
        decision.decision,
        decision.context,
        decision.alternatives == null ? null : toJson(decision.alternatives),
        decision.decidedBy,
        decision.supersedesId,
      )
    return this.list({ runId: decision.runId ?? undefined, taskId: decision.taskId ?? undefined, specId: decision.specId ?? undefined }).find((item) => item.id === decision.id)!
  }
}
