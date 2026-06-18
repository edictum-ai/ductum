import type { Evidence, EvidenceId, GateEvaluation, RunId } from '../types.js'
import type { AttemptLeaseRepo, EvidenceRepo, GateEvaluationRepo } from './interfaces.js'
import type { FencingToken } from '../attempt-lease.js'
import { redactPublicOutput, redactPublicText } from '../public-redaction.js'
import { replayableEvidenceContentSha } from '../evidence-content-hash.js'
import {
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface EvidenceRow {
  id: EvidenceId
  run_id: string
  type: Evidence['type']
  payload: string
  created_at: string
}

interface GateEvaluationRow {
  id: number
  run_id: string
  gate_type: GateEvaluation['gateType']
  target: string
  result: GateEvaluation['result']
  reason: string | null
  observed: number
  created_at: string
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    runId: row.run_id as RunId,
    type: row.type,
    payload: parseJson<Record<string, unknown>>(row.payload),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

function mapEvaluation(row: GateEvaluationRow): GateEvaluation {
  return {
    id: row.id,
    runId: row.run_id as RunId,
    gateType: row.gate_type,
    target: row.target,
    result: row.result,
    reason: row.reason,
    // SQLite stores BOOLEAN as INTEGER (0/1). Coerce to real boolean so
    // the dashboard can render it without a truthy-vs-numeric footgun.
    observed: row.observed === 1,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

export class SqliteEvidenceRepo implements EvidenceRepo {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly attemptLeaseRepo?: AttemptLeaseRepo,
  ) {}

  list(runId: RunId): Evidence[] {
    return this.db
      .prepare('SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at, rowid')
      .all(runId)
      .map((row) => mapEvidence(row as EvidenceRow))
  }

  listByRunIds(runIds: readonly RunId[]): Evidence[] {
    if (runIds.length === 0) return []
    const placeholders = runIds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM evidence WHERE run_id IN (${placeholders}) ORDER BY created_at, rowid`)
      .all(...runIds)
      .map((row) => mapEvidence(row as EvidenceRow))
  }

  create(evidence: Omit<Evidence, 'createdAt'>): Evidence {
    const safePayload = redactPublicOutput(evidence.payload)
    const contentSha = replayableEvidenceContentSha(evidence.type, safePayload)
    const result = this.db
      .prepare(
        'INSERT INTO evidence (id, run_id, type, payload, content_sha) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, content_sha) DO NOTHING',
      )
      .run(evidence.id, evidence.runId, evidence.type, toJson(safePayload), contentSha)
    if (result.changes === 0) {
      // Idempotent dedup: identical evidence for this run is already recorded. Return the
      // existing row instead of duplicating or throwing on the PK (the non-idempotent-INSERT fix).
      const existing = this.db
        .prepare('SELECT * FROM evidence WHERE run_id = ? AND content_sha = ?')
        .get(evidence.runId, contentSha) as EvidenceRow | undefined
      return mapEvidence(assertFound(existing, `Evidence dedup target missing: ${evidence.runId}`))
    }
    const row = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidence.id) as EvidenceRow | undefined
    return mapEvidence(assertFound(row, `Evidence not found: ${evidence.id}`))
  }

  createFenced(evidence: Omit<Evidence, 'createdAt'>, fenceToken: FencingToken, now?: Date): Evidence {
    if (this.attemptLeaseRepo == null) throw new Error('Attempt lease repo is required for fenced evidence writes')
    this.attemptLeaseRepo.assertCanWrite(evidence.runId, fenceToken, now)
    return this.create(evidence)
  }
}

export class SqliteGateEvaluationRepo implements GateEvaluationRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(runId: RunId): GateEvaluation[] {
    return this.db
      .prepare('SELECT * FROM gate_evaluations WHERE run_id = ? ORDER BY id')
      .all(runId)
      .map((row) => mapEvaluation(row as GateEvaluationRow))
  }

  create(evaluation: Omit<GateEvaluation, 'id' | 'createdAt'>): GateEvaluation {
    const result = this.db
      .prepare(
        'INSERT INTO gate_evaluations (run_id, gate_type, target, result, reason, observed) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        evaluation.runId,
        evaluation.gateType,
        redactPublicText(evaluation.target),
        evaluation.result,
        evaluation.reason == null ? null : redactPublicText(evaluation.reason),
        evaluation.observed ? 1 : 0,
      )
    const row = this.db
      .prepare('SELECT * FROM gate_evaluations WHERE id = ?')
      .get(result.lastInsertRowid) as GateEvaluationRow | undefined
    return mapEvaluation(assertFound(row, 'Gate evaluation was not created'))
  }
}
