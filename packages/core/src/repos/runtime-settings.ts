import type { FactoryId } from '../types.js'
import type { FactoryRuntimePatch, FactoryRuntimePersistedSettings } from '../factory-settings-types.js'
import type { FactoryRuntimeSettingsRecord } from '../factory-settings-store-types.js'
import type { FactoryRuntimeSettingsRepo } from './factory-settings-interfaces.js'
import { fromBoolean, toBoolean, toIsoString, type SqliteDatabase } from './utils.js'

interface RuntimeSettingsRow {
  factory_id: FactoryId
  api_bind_host: string | null
  api_port: number | null
  public_api_url: string | null
  dashboard_url: string | null
  dispatcher_enabled: number | null
  dispatcher_heartbeat_interval_seconds: number | null
  worktree_enabled: number | null
  worktree_base_path: string | null
  created_at: string
  updated_at: string
}

const EMPTY_DESIRED: FactoryRuntimePersistedSettings = {
  apiBindHost: null,
  apiPort: null,
  publicApiUrl: null,
  dashboardUrl: null,
  dispatcherEnabled: null,
  dispatcherHeartbeatIntervalSeconds: null,
  worktreeEnabled: null,
  worktreeBasePath: null,
}

export class SqliteFactoryRuntimeSettingsRepo implements FactoryRuntimeSettingsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(factoryId: FactoryId): FactoryRuntimeSettingsRecord | null {
    const row = this.db
      .prepare('SELECT * FROM factory_runtime_settings WHERE factory_id = ?')
      .get(factoryId) as RuntimeSettingsRow | undefined
    return row == null ? null : mapRuntimeSettings(row)
  }

  upsert(factoryId: FactoryId, patch: FactoryRuntimePatch): FactoryRuntimeSettingsRecord {
    const existing = this.get(factoryId)
    const next = { ...(existing ?? EMPTY_DESIRED), ...patch }
    if (existing == null) {
      this.db.prepare(`
        INSERT INTO factory_runtime_settings (
          factory_id, api_bind_host, api_port, public_api_url, dashboard_url,
          dispatcher_enabled, dispatcher_heartbeat_interval_seconds,
          worktree_enabled, worktree_base_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...runtimeValues(factoryId, next))
    } else {
      this.db.prepare(`
        UPDATE factory_runtime_settings
          SET api_bind_host = ?,
              api_port = ?,
              public_api_url = ?,
              dashboard_url = ?,
              dispatcher_enabled = ?,
              dispatcher_heartbeat_interval_seconds = ?,
              worktree_enabled = ?,
              worktree_base_path = ?,
              updated_at = datetime('now')
          WHERE factory_id = ?
      `).run(...runtimeValues(factoryId, next).slice(1), factoryId)
    }
    return this.get(factoryId)!
  }
}

function mapRuntimeSettings(row: RuntimeSettingsRow): FactoryRuntimeSettingsRecord {
  return {
    factoryId: row.factory_id,
    apiBindHost: row.api_bind_host,
    apiPort: row.api_port,
    publicApiUrl: row.public_api_url,
    dashboardUrl: row.dashboard_url,
    dispatcherEnabled: row.dispatcher_enabled == null ? null : toBoolean(row.dispatcher_enabled),
    dispatcherHeartbeatIntervalSeconds: row.dispatcher_heartbeat_interval_seconds,
    worktreeEnabled: row.worktree_enabled == null ? null : toBoolean(row.worktree_enabled),
    worktreeBasePath: row.worktree_base_path,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

function runtimeValues(factoryId: FactoryId, value: FactoryRuntimePersistedSettings): unknown[] {
  return [
    factoryId,
    value.apiBindHost,
    value.apiPort,
    value.publicApiUrl,
    value.dashboardUrl,
    value.dispatcherEnabled == null ? null : fromBoolean(value.dispatcherEnabled),
    value.dispatcherHeartbeatIntervalSeconds,
    value.worktreeEnabled == null ? null : fromBoolean(value.worktreeEnabled),
    value.worktreeBasePath,
  ]
}
