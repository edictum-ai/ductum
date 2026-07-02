import type { RunId } from '../types.js'
import type {
  FactorySecretAccessEvent,
  FactorySecretAccessEventInput,
} from '../factory-settings-store-types.js'
import type { FactorySecretAccessLogRepo } from './factory-settings-interfaces.js'
import type { SqliteDatabase } from './utils.js'

/**
 * Append-only SQLite backing for the P1 Secret Access Log (issue #210).
 * See migration 050 for the schema. Returned rows are value-free: only ids,
 * outcome, sanitized error message, and timestamp.
 */
export class SqliteFactorySecretAccessLogRepo implements FactorySecretAccessLogRepo {
  constructor(private readonly db: SqliteDatabase) {}

  record(input: FactorySecretAccessEventInput): FactorySecretAccessEvent {
    return this.db
      .prepare(
        `INSERT INTO factory_secret_access_log
            (id, secret_id, run_id, agent_id, outcome, error_message, attempted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id, secret_id AS secretId, run_id AS runId, agent_id AS agentId,
                   outcome, error_message AS errorMessage, attempted_at AS attemptedAt`,
      )
      .get(
        input.id,
        input.secretId,
        input.runId,
        input.agentId,
        input.outcome,
        input.errorMessage,
        input.attemptedAt,
      ) as FactorySecretAccessEvent
  }

  listBySecret(secretId: string, limit = 100): FactorySecretAccessEvent[] {
    return this.db
      .prepare(
        `SELECT id, secret_id AS secretId, run_id AS runId, agent_id AS agentId,
                outcome, error_message AS errorMessage, attempted_at AS attemptedAt
         FROM factory_secret_access_log
         WHERE secret_id = ?
         ORDER BY attempted_at DESC, id DESC
         LIMIT ?`,
      )
      .all(secretId, limit) as FactorySecretAccessEvent[]
  }

  listByRun(runId: RunId, limit = 100): FactorySecretAccessEvent[] {
    return this.db
      .prepare(
        `SELECT id, secret_id AS secretId, run_id AS runId, agent_id AS agentId,
                outcome, error_message AS errorMessage, attempted_at AS attemptedAt
         FROM factory_secret_access_log
         WHERE run_id = ?
         ORDER BY attempted_at DESC, id DESC
         LIMIT ?`,
      )
      .all(runId, limit) as FactorySecretAccessEvent[]
  }
}
