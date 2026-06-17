import type { FactoryId } from '../types.js'
import type { FactoryHomeViewState, FactoryHomeViewStatePatch } from '../factory-view-state-types.js'
import { toIsoString, type SqliteDatabase } from './utils.js'

interface FactoryViewStateRow {
  factory_id: FactoryId
  home_last_seen_at: string | null
  created_at: string
  updated_at: string
}

export class SqliteFactoryViewStateRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(factoryId: FactoryId): FactoryHomeViewState | null {
    const row = this.db
      .prepare('SELECT * FROM factory_view_state WHERE factory_id = ?')
      .get(factoryId) as FactoryViewStateRow | undefined
    return row == null ? null : mapViewState(row)
  }

  upsert(factoryId: FactoryId, patch: FactoryHomeViewStatePatch): FactoryHomeViewState {
    const homeLastSeenAt = canonicalHomeLastSeenAt(patch.homeLastSeenAt)
    this.db.prepare(`
      INSERT INTO factory_view_state (factory_id, home_last_seen_at)
      VALUES (?, ?)
      ON CONFLICT(factory_id) DO UPDATE SET
        home_last_seen_at = CASE
          WHEN factory_view_state.home_last_seen_at IS NULL THEN excluded.home_last_seen_at
          WHEN excluded.home_last_seen_at IS NULL THEN factory_view_state.home_last_seen_at
          WHEN excluded.home_last_seen_at > factory_view_state.home_last_seen_at THEN excluded.home_last_seen_at
          ELSE factory_view_state.home_last_seen_at
        END,
        updated_at = CASE
          WHEN factory_view_state.home_last_seen_at IS NULL AND excluded.home_last_seen_at IS NOT NULL THEN datetime('now')
          WHEN excluded.home_last_seen_at IS NOT NULL AND excluded.home_last_seen_at > factory_view_state.home_last_seen_at THEN datetime('now')
          ELSE factory_view_state.updated_at
        END
    `).run(factoryId, homeLastSeenAt)
    return this.get(factoryId)!
  }
}

function canonicalHomeLastSeenAt(value: string | null): string | null {
  if (value == null) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('homeLastSeenAt must be a canonical ISO timestamp or null')
  }
  return value
}

function mapViewState(row: FactoryViewStateRow): FactoryHomeViewState {
  return {
    factoryId: row.factory_id,
    homeLastSeenAt: toIsoString(row.home_last_seen_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}
