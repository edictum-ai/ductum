import { existsSync, statSync } from 'node:fs'

import {
  buildFactoryDoctorReport,
  buildFactorySettingsCatalogs,
  DEFAULT_WORKTREE_CONFIG,
  DUCTUM_SCHEMA_VERSION,
  inspectFactoryDatabase,
  readSchemaMigrationStatus,
  type SchemaMigrationStatus,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import type { AuditLogEntry } from './audit-log.js'
import { listAuditLog } from './audit-log.js'
import { factoryDoctorAuthProbe } from './factory-doctor-probe.js'
import { buildApiRepairInputSync } from './repair.js'
import type { OpsWorktreeInventory } from './ops-health-worktrees.js'
import { collectWorktreeInventory } from './ops-health-worktrees.js'

export type OpsHealthStatus = 'ready' | 'degraded' | 'blocked' | 'unknown'

export interface OpsHealthProcess {
  status: OpsHealthStatus
  apiBindHost: string | null
  apiPort: number | null
  publicApiUrl: string | null
  dashboardUrl: string | null
  dbPath: string | null
  factoryDataDir: string | null
  uptimeSeconds: number | null
  dispatcher: {
    enabled: boolean
    running: boolean
    activeRuns: number
    maxConcurrentRuns: number
    lastCycleAt: string | null
    adapterCount: number
    adapters: string[]
    reason: string | null
  }
}

export interface OpsHealthDoctor {
  status: 'ready' | 'blocked' | 'deferred'
  summary: { ready: number; blocked: number; deferred: number }
}

export interface OpsHealthDatabase {
  path: string | null
  exists: boolean
  sizeBytes: number | null
  factoryState: 'missing' | 'no_schema' | 'empty' | 'has_factory' | 'unknown'
  schema:
    | (SchemaMigrationStatus & {
        headMigrationId: string | null
        binarySchemaVersion: number
        current: boolean
      })
    | { unavailable: true; reason: string }
  backupRestore: {
    available: false
    reason: string
  }
}

export interface OpsHealthLogEntry extends AuditLogEntry {}

export interface OpsHealthLogs {
  available: true
  recent: OpsHealthLogEntry[]
}

export interface OpsHealthLogsUnavailable {
  available: false
  reason: string
}

export interface OpsHealthReport {
  generatedAt: string
  status: OpsHealthStatus
  process: OpsHealthProcess
  doctor: OpsHealthDoctor
  database: OpsHealthDatabase
  worktrees: OpsWorktreeInventory
  logs: OpsHealthLogs | OpsHealthLogsUnavailable
}

export interface OpsHealthCleanupInput {
  /** Must be the literal boolean `true` to perform destructive cleanup. */
  confirm?: unknown
}

export interface OpsHealthCleanupResult {
  outcome: 'success' | 'unavailable' | 'error'
  removed: number
  reason: string | null
}

export async function buildOpsHealthReport(context: ApiContext): Promise<OpsHealthReport> {
  const generatedAt = context.now().toISOString()
  const process = buildProcess(context)
  const doctor = buildDoctor(context)
  const database = buildDatabase(context)
  const worktrees = await collectWorktreeInventory(
    resolveWorktreeBasePath(context),
    context.runtime.worktreeEnabled !== false,
  )
  const logs = buildLogs(context)
  return {
    generatedAt,
    status: aggregateStatus({ process, doctor, database, worktrees, logs }),
    process,
    doctor,
    database,
    worktrees,
    logs,
  }
}

function resolveWorktreeBasePath(context: ApiContext): string | null {
  const configured = context.runtime.worktreeBasePath?.trim()
  if (configured != null && configured !== '') return configured
  if (context.runtime.worktreeEnabled === false) return null
  return DEFAULT_WORKTREE_CONFIG.basePath
}

function buildProcess(context: ApiContext): OpsHealthProcess {
  const dispatcherStatus = context.getDispatcherStatus == null
    ? {
      running: false,
      activeRuns: context.repos.runs.getActive().length,
      maxConcurrentRuns: 0,
      lastCycleAt: null,
      enabled: false,
      adapterCount: 0,
      adapters: [],
      reason: 'dispatcher support not loaded',
    }
    : context.getDispatcherStatus()
  const enabled = dispatcherStatus.enabled
  const running = dispatcherStatus.running
  return {
    status: !enabled ? 'degraded' : running ? 'ready' : 'degraded',
    apiBindHost: context.runtime.apiBindHost ?? null,
    apiPort: context.runtime.apiPort ?? null,
    publicApiUrl: context.runtime.publicApiUrl ?? null,
    dashboardUrl: context.runtime.dashboardUrl ?? null,
    dbPath: context.runtime.dbPath ?? null,
    factoryDataDir: context.runtime.factoryDataDir ?? null,
    uptimeSeconds: typeof globalThis.process === 'object' && globalThis.process != null && typeof globalThis.process.uptime === 'function'
      ? Math.max(0, Math.round(globalThis.process.uptime()))
      : null,
    dispatcher: {
      enabled,
      running,
      activeRuns: dispatcherStatus.activeRuns,
      maxConcurrentRuns: dispatcherStatus.maxConcurrentRuns,
      lastCycleAt: dispatcherStatus.lastCycleAt,
      adapterCount: dispatcherStatus.adapterCount,
      adapters: dispatcherStatus.adapters,
      reason: dispatcherStatus.reason ?? null,
    },
  }
}

function buildDoctor(context: ApiContext): OpsHealthDoctor {
  const repairInput = buildApiRepairInputSync(context)
  const catalogs = buildFactorySettingsCatalogs({
    factory: context.repos.factory.get(),
    configResources: context.repos.configResources.list(),
    agents: context.repos.agents.list(),
    costBudget: context.costBudget,
  })
  const factory = context.repos.factory.get()
  const assignments = factory == null
    ? []
    : context.repos.projects.list(factory.id).flatMap((project) => context.repos.projectAgents.list(project.id))
  const report = buildFactoryDoctorReport({
    catalogs,
    agents: context.repos.agents.list(),
    assignments,
    secrets: context.repos.secrets.list(),
    env: process.env,
    authProbe: (input) => factoryDoctorAuthProbe(input, repairInput.host),
  })
  return { status: report.status, summary: report.summary }
}

function buildDatabase(context: ApiContext): OpsHealthDatabase {
  const path = context.runtime.dbPath ?? null
  if (path == null) {
    return {
      path: null,
      exists: false,
      sizeBytes: null,
      factoryState: 'unknown',
      schema: { unavailable: true, reason: 'Database path is not exposed by the runtime.' },
      backupRestore: {
        available: false,
        reason: 'No backup/restore primitive exists in this build; restore flows must come from OS-level snapshots.',
      },
    }
  }
  const exists = existsSync(path)
  let sizeBytes: number | null = null
  let factoryState: OpsHealthDatabase['factoryState'] = 'unknown'
  if (exists) {
    sizeBytes = sqliteStorageSizeBytes(path)
    try {
      factoryState = inspectFactoryDatabase(path).state
    } catch {
      factoryState = 'unknown'
    }
  }
  let schema: OpsHealthDatabase['schema']
  try {
    const status = readSchemaMigrationStatus(context.db)
    schema = {
      ...status,
      binarySchemaVersion: DUCTUM_SCHEMA_VERSION,
      headMigrationId: status.appliedMigrationIds.at(-1) ?? null,
      current: status.unknownMigrationIds.length === 0
        && status.appliedSchemaVersion === DUCTUM_SCHEMA_VERSION,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    schema = { unavailable: true, reason: `Schema status read failed: ${message}` }
  }
  return {
    path,
    exists,
    sizeBytes,
    factoryState,
    schema,
    backupRestore: {
      available: false,
      reason: 'No backup/restore primitive exists in this build; restore flows must come from OS-level snapshots.',
    },
  }
}

function buildLogs(context: ApiContext): OpsHealthLogs | OpsHealthLogsUnavailable {
  try {
    const page = listAuditLog(context, { limit: 10 })
    return { available: true, recent: page.items }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { available: false, reason: `Audit log unavailable: ${message}` }
  }
}

function aggregateStatus(input: {
  process: OpsHealthProcess
  doctor: OpsHealthDoctor
  database: OpsHealthDatabase
  worktrees: OpsWorktreeInventory
  logs: OpsHealthLogs | OpsHealthLogsUnavailable
}): OpsHealthStatus {
  if (input.process.status === 'blocked' || input.doctor.status === 'blocked') return 'blocked'
  if (!input.database.exists) return 'blocked'
  if (input.database.factoryState === 'missing' || input.database.factoryState === 'no_schema' || input.database.factoryState === 'empty') {
    return 'blocked'
  }
  if (input.process.status === 'degraded' || input.doctor.status === 'deferred') return 'degraded'
  if (input.database.factoryState === 'unknown') return 'degraded'
  if ('unavailable' in input.database.schema) {
    if (input.database.schema.unavailable) return 'degraded'
  } else if (!input.database.schema.current) {
    return 'degraded'
  }
  if (input.worktrees.error != null || input.worktrees.entries.some((entry) => entry.exists && !entry.accessible)) return 'degraded'
  if (input.logs.available === false) return 'degraded'
  return 'ready'
}

function sqliteStorageSizeBytes(path: string): number | null {
  let total = 0
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (!existsSync(candidate)) continue
    try {
      total += statSync(candidate).size
    } catch {
      return null
    }
  }
  return total
}
