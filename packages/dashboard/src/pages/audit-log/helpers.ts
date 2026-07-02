import { redactPublicText } from '@ductum/public-redaction'
import type { AuditLogEntry, AuditLogQuery } from '@/api/client'
import { shortHostPath, shortId } from '@/lib/display'
import { hasRedactionMarker } from '@/lib/project-display'

export const AUDIT_FILTER_KEYS = [
  'actor',
  'project',
  'projectId',
  'specId',
  'taskId',
  'runId',
  'eventType',
  'status',
  'from',
  'to',
] as const

export type AuditFilterKey = (typeof AUDIT_FILTER_KEYS)[number]

export const AUDIT_LIMIT = '50'

export function queryFromSearch(search: URLSearchParams): AuditLogQuery {
  const query: AuditLogQuery = { limit: search.get('limit') || AUDIT_LIMIT }
  for (const key of AUDIT_FILTER_KEYS) {
    const value = search.get(key)?.trim()
    if (value) query[key] = value
  }
  const cursor = search.get('cursor')?.trim()
  if (cursor) query.cursor = cursor
  return query
}

export function auditTarget(entry: AuditLogEntry): { label: string; href: string | null } {
  const project = displayName(entry.projectName, entry.projectId, 'Project')
  const spec = displayName(entry.specName, entry.specId, 'Spec')
  const task = displayName(entry.taskName, entry.taskId, 'Task')
  const parts = [project, spec, task].filter((value): value is string => value != null)
  if (entry.runId != null) parts.push(`Attempt ${shortId(entry.runId)}`)
  const label = parts.length === 0 ? 'Factory' : parts.join(' / ')
  return { label, href: auditTargetHref(entry) }
}

export function auditTargetHref(entry: AuditLogEntry): string | null {
  const project = routePart(entry.projectName, entry.projectId)
  if (project == null) return null
  const spec = routePart(entry.specName, entry.specId)
  const task = routePart(entry.taskName, entry.taskId)
  if (entry.runId != null && spec != null && task != null) {
    return `/${enc(project)}/${enc(spec)}/${enc(task)}/${enc(shortId(entry.runId))}`
  }
  if (spec != null) return `/${enc(project)}/${enc(spec)}`
  return `/${enc(project)}`
}

export function eventLabel(value: string): string {
  return value.replaceAll('.', ' ')
}

export function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export function auditTone(status: string): 'ok' | 'warn' | 'err' | 'info' | 'mid' {
  const normalized = status.toLowerCase()
  if (['success', 'pass', 'passed', 'applied', 'recorded', 'done'].includes(normalized)) return 'ok'
  if (['failure', 'failed', 'error', 'blocked'].includes(normalized)) return 'err'
  if (['cancelled', 'stalled', 'retry', 'warning'].includes(normalized)) return 'warn'
  if (['running', 'active', 'pending'].includes(normalized)) return 'info'
  return 'mid'
}

export function metadataRows(metadata: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(metadata)
    .map(([key, value]) => [key, displayMetadata(value)] as [string, string])
    .filter(([, value]) => value.trim() !== '')
}

export function displayMetadata(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return displayAuditText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(displayMetadata).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const rows = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${displayMetadata(item)}`)
      .filter((item) => !hasRedactionMarker(item))
    return rows.join('; ')
  }
  return ''
}

export function displayAuditText(value: string): string {
  const redacted = redactPublicText(value)
  if (hasRedactionMarker(redacted)) return '[redacted]'
  return redacted.replace(
    /\/(?:Users\/[^/\s"'<>]+\/(?:project|\.ductum)|tmp\/(?:ductum\/)?worktrees)\/[^\s"'<>)]*/g,
    (path) => shortAuditPath(path),
  )
}

export function formatAuditTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function displayName(name: string | null, id: string | null, fallback: string): string | null {
  if (name != null && name.trim() !== '' && !hasRedactionMarker(name)) return name
  if (id != null && id.trim() !== '') return `${fallback} ${shortId(id)}`
  return null
}

function routePart(name: string | null, id: string | null): string | null {
  if (name != null && name.trim() !== '' && !hasRedactionMarker(name)) return name
  if (id != null && id.trim() !== '') return id
  return null
}

function shortAuditPath(value: string): string {
  const factory = value.match(/\/\.ductum\/factories\/[^/]+\/[^/]+\/\.ductum\/worktrees\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(.+))?$/)
  if (factory) return factory[4] == null ? `${factory[1]}/${factory[2]}/${factory[3]}` : `${factory[1]}/${factory[2]}/${factory[4]}`
  return shortHostPath(value)
}

function enc(value: string): string {
  return encodeURIComponent(value)
}
