import type { RunId, SessionRunMapping } from '../types.js'
import { createSessionControlToken } from '../session-control-token.js'
import type { SessionRunMappingRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  toIsoString,
  type SqliteDatabase,
} from './utils.js'

interface SessionRunMappingRow {
  session_id: string
  run_id: string
  harness: SessionRunMapping['harness']
  control_token: string
  working_dir: string | null
  harness_session_id: string | null
  worker_pid: number | null
  worker_ownership_kind: SessionRunMapping['workerOwnershipKind']
  worker_started_at: string | null
  worker_ownership_unsupported_reason: string | null
  created_at: string
}

function mapMapping(row: SessionRunMappingRow): SessionRunMapping {
  return {
    sessionId: row.session_id,
    runId: row.run_id as RunId,
    harness: row.harness,
    controlToken: row.control_token,
    workingDir: row.working_dir,
    harnessSessionId: row.harness_session_id,
    workerPid: row.worker_pid,
    workerOwnershipKind: row.worker_ownership_kind,
    workerStartedAt: row.worker_started_at,
    workerOwnershipUnsupportedReason: row.worker_ownership_unsupported_reason,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

export class SqliteSessionRunMappingRepo implements SessionRunMappingRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(sessionId: string): SessionRunMapping | null {
    const row = this.db
      .prepare('SELECT * FROM session_run_mapping WHERE session_id = ?')
      .get(sessionId) as SessionRunMappingRow | undefined
    return row == null ? null : mapMapping(row)
  }

  getByRunId(runId: RunId): SessionRunMapping | null {
    const row = this.db
      .prepare('SELECT * FROM session_run_mapping WHERE run_id = ?')
      .get(runId) as SessionRunMappingRow | undefined
    return row == null ? null : mapMapping(row)
  }

  create(
    mapping: Omit<SessionRunMapping, 'createdAt' | 'controlToken'> & {
      controlToken?: string | null
    },
  ): SessionRunMapping {
    const controlToken = mapping.controlToken ?? createSessionControlToken()
    this.db
      .prepare(
        'INSERT INTO session_run_mapping (session_id, run_id, harness, control_token, working_dir, harness_session_id, worker_pid, worker_ownership_kind, worker_started_at, worker_ownership_unsupported_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        mapping.sessionId,
        mapping.runId,
        mapping.harness,
        controlToken,
        mapping.workingDir ?? null,
        mapping.harnessSessionId ?? null,
        mapping.workerPid ?? null,
        mapping.workerOwnershipKind ?? null,
        mapping.workerStartedAt ?? null,
        mapping.workerOwnershipUnsupportedReason ?? null,
      )
    return assertFound(this.get(mapping.sessionId), `Session mapping not found: ${mapping.sessionId}`)
  }

  updateHarnessSessionId(sessionId: string, harnessSessionId: string): SessionRunMapping {
    const result = this.db
      .prepare('UPDATE session_run_mapping SET harness_session_id = ? WHERE session_id = ?')
      .run(harnessSessionId, sessionId)
    assertChanges(result.changes, `Session mapping not found: ${sessionId}`)
    return assertFound(this.get(sessionId), `Session mapping not found: ${sessionId}`)
  }

  updateSessionId(
    sessionId: string,
    nextSessionId: string,
    updates: Pick<
      SessionRunMapping,
      'harnessSessionId' | 'workerPid' | 'workerOwnershipKind' | 'workerStartedAt' | 'workerOwnershipUnsupportedReason'
    > = {},
  ): SessionRunMapping {
    const result = this.db
      .prepare(
        'UPDATE session_run_mapping SET session_id = ?, harness_session_id = ?, worker_pid = ?, worker_ownership_kind = ?, worker_started_at = ?, worker_ownership_unsupported_reason = ? WHERE session_id = ?',
      )
      .run(
        nextSessionId,
        updates.harnessSessionId ?? null,
        updates.workerPid ?? null,
        updates.workerOwnershipKind ?? null,
        updates.workerStartedAt ?? null,
        updates.workerOwnershipUnsupportedReason ?? null,
        sessionId,
      )
    assertChanges(result.changes, `Session mapping not found: ${sessionId}`)
    return assertFound(this.get(nextSessionId), `Session mapping not found: ${nextSessionId}`)
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM session_run_mapping WHERE session_id = ?').run(sessionId)
  }
}
