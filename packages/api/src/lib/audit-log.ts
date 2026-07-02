import { createId, redactPublicOutput, redactPublicText, type SqliteDatabase } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'
import { auditRowsSql } from './audit-log-sources.js'

export interface AuditLogFilters {
  actor?: string
  projectId?: string
  project?: string
  specId?: string
  taskId?: string
  runId?: string
  eventType?: string
  status?: string
  from?: string
  to?: string
  limit?: number
  cursor?: string
}

export interface AuditLogEventInput {
  actor?: string | null
  projectId?: string | null
  specId?: string | null
  taskId?: string | null
  runId?: string | null
  eventType: string
  status: string
  title: string
  summary?: string | null
  metadata?: Record<string, unknown>
  occurredAt?: string
}

export interface AuditLogEntry {
  id: string
  source: string
  sourceId: string
  occurredAt: string
  actor: string | null
  projectId: string | null
  projectName: string | null
  specId: string | null
  specName: string | null
  taskId: string | null
  taskName: string | null
  runId: string | null
  eventType: string
  status: string
  title: string
  summary: string | null
  metadata: Record<string, unknown>
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  nextCursor: string | null
}

interface AuditLogRow {
  id: string
  source: string
  sourceId: string
  occurred_at: string
  actor: string | null
  project_id: string | null
  project_name: string | null
  spec_id: string | null
  spec_name: string | null
  task_id: string | null
  task_name: string | null
  run_id: string | null
  event_type: string
  status: string
  title: string
  summary: string | null
  metadata: string | null
}

interface Cursor {
  occurredAt: string
  id: string
}

export function listAuditLog(context: ApiContext, filters: AuditLogFilters): AuditLogPage {
  const limit = auditLimit(filters.limit)
  const { where, params } = auditWhere(filters)
  const rows = context.db
    .prepare(`${auditRowsSql()} ${where} ORDER BY julianday(occurred_at) DESC, id DESC LIMIT ?`)
    .all(...params, limit + 1) as AuditLogRow[]
  const pageRows = rows.slice(0, limit)
  const next = rows.length > limit ? pageRows.at(-1) : undefined
  return {
    items: pageRows.map(mapAuditRow),
    nextCursor: next == null ? null : encodeCursor({ occurredAt: next.occurred_at, id: next.id }),
  }
}

export function recordAuditEvent(context: ApiContext, input: AuditLogEventInput): void {
  insertAuditEvent(context.db, {
    ...input,
    occurredAt: input.occurredAt ?? context.now().toISOString(),
  })
}

function insertAuditEvent(db: SqliteDatabase, input: Required<Pick<AuditLogEventInput, 'occurredAt'>> & AuditLogEventInput): void {
  db.prepare(
    `INSERT INTO audit_events
      (id, actor, project_id, spec_id, task_id, run_id, event_type, status, title, summary, metadata, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    createId<'AuditEventId'>(),
    input.actor ?? 'operator',
    input.projectId ?? null,
    input.specId ?? null,
    input.taskId ?? null,
    input.runId ?? null,
    safeText(input.eventType),
    safeText(input.status),
    safeText(input.title),
    input.summary == null ? null : safeText(input.summary),
    JSON.stringify(redactPublicOutput(input.metadata ?? {})),
    input.occurredAt,
  )
}

function auditWhere(filters: AuditLogFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  addTextFilter(clauses, params, 'actor', filters.actor)
  addTextFilter(clauses, params, 'project_id', filters.projectId)
  addTextFilter(clauses, params, 'project_name', filters.project)
  addTextFilter(clauses, params, 'spec_id', filters.specId)
  addTextFilter(clauses, params, 'task_id', filters.taskId)
  addTextFilter(clauses, params, 'run_id', filters.runId)
  addTextFilter(clauses, params, 'event_type', filters.eventType)
  addTextFilter(clauses, params, 'status', filters.status)
  if (filters.from != null) {
    clauses.push('julianday(occurred_at) >= julianday(?)')
    params.push(filters.from)
  }
  if (filters.to != null) {
    clauses.push('julianday(occurred_at) <= julianday(?)')
    params.push(filters.to)
  }
  const cursor = decodeCursor(filters.cursor)
  if (cursor != null) {
    clauses.push('(julianday(occurred_at) < julianday(?) OR (julianday(occurred_at) = julianday(?) AND id < ?))')
    params.push(cursor.occurredAt, cursor.occurredAt, cursor.id)
  }
  return { where: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, params }
}

function addTextFilter(clauses: string[], params: unknown[], column: string, value: string | undefined): void {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return
  clauses.push(`lower(coalesce(${column}, '')) = lower(?)`)
  params.push(trimmed)
}

function auditLimit(raw: number | undefined): number {
  if (raw == null) return 50
  if (!Number.isFinite(raw) || raw <= 0) throw new ValidationError('limit must be a positive number')
  return Math.min(200, Math.max(1, Math.floor(raw)))
}

function mapAuditRow(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    occurredAt: toIso(row.occurred_at),
    actor: row.actor,
    projectId: row.project_id,
    projectName: row.project_name,
    specId: row.spec_id,
    specName: row.spec_name,
    taskId: row.task_id,
    taskName: row.task_name,
    runId: row.run_id,
    eventType: row.event_type,
    status: row.status,
    title: row.title,
    summary: row.summary,
    metadata: parseMetadata(row.metadata),
  }
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (value == null || value.trim() === '') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? redactPublicOutput(parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function encodeCursor(cursor: Cursor): string {
  return encodeURIComponent(JSON.stringify(cursor))
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (value == null || value.trim() === '') return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Cursor
    if (typeof parsed.occurredAt === 'string' && typeof parsed.id === 'string') return parsed
  } catch {
    // handled below
  }
  throw new ValidationError('cursor is invalid')
}

function safeText(value: string): string {
  return redactPublicText(value)
}

function toIso(value: string): string {
  if (value.includes('T')) return value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  return `${value.replace(' ', 'T')}Z`
}
