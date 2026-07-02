import type {
  OperatorSessionInput,
  OperatorSessionRecord,
  PublicOperatorSession,
} from '../operator-session-types.js'
import { publicOperatorSession } from '../operator-session-types.js'
import type { SqliteDatabase } from './utils.js'

interface OperatorSessionRow {
  id: string
  token_hash: string
  operator_token_hash: string
  actor: string
  scopes: string
  project_ids: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  last_seen_at: string | null
}

export class SqliteOperatorSessionRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: OperatorSessionInput): OperatorSessionRecord {
    this.db.prepare(`
      INSERT INTO operator_sessions
        (id, token_hash, operator_token_hash, actor, scopes, project_ids, created_at, expires_at, revoked_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.tokenHash,
      input.operatorTokenHash,
      input.actor,
      JSON.stringify(input.scopes),
      input.projectIds == null ? null : JSON.stringify(input.projectIds),
      input.createdAt,
      input.expiresAt,
      input.revokedAt ?? null,
      input.lastSeenAt ?? null,
    )
    return this.get(input.id)!
  }

  get(id: string): OperatorSessionRecord | null {
    const row = this.db.prepare('SELECT * FROM operator_sessions WHERE id = ?').get(id) as OperatorSessionRow | undefined
    return row == null ? null : mapRow(row)
  }

  getByTokenHash(tokenHash: string): OperatorSessionRecord | null {
    const row = this.db.prepare('SELECT * FROM operator_sessions WHERE token_hash = ?').get(tokenHash) as OperatorSessionRow | undefined
    return row == null ? null : mapRow(row)
  }

  list(limit = 100): PublicOperatorSession[] {
    return (this.db.prepare(`
      SELECT * FROM operator_sessions
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit) as OperatorSessionRow[]).map(mapRow).map(publicOperatorSession)
  }

  touch(id: string, lastSeenAt: string): OperatorSessionRecord | null {
    this.db.prepare(`
      UPDATE operator_sessions
      SET last_seen_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(lastSeenAt, id)
    return this.get(id)
  }

  revoke(id: string, revokedAt: string): OperatorSessionRecord | null {
    this.db.prepare(`
      UPDATE operator_sessions
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ?
    `).run(revokedAt, id)
    return this.get(id)
  }

  pruneExpired(now: string): number {
    return this.db.prepare('DELETE FROM operator_sessions WHERE expires_at <= ?').run(now).changes
  }
}

function mapRow(row: OperatorSessionRow): OperatorSessionRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    operatorTokenHash: row.operator_token_hash,
    actor: row.actor,
    scopes: JSON.parse(row.scopes) as OperatorSessionRecord['scopes'],
    projectIds: row.project_ids == null ? null : JSON.parse(row.project_ids) as OperatorSessionRecord['projectIds'],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
  }
}
