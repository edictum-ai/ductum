import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import {
  publicOperatorSession,
  type OperatorSessionRecord,
  type OperatorSessionScope,
  type ProjectId,
  type PublicOperatorSession,
  type SqliteOperatorSessionRepo,
} from '@ductum/core'

const COOKIE_NAME = 'ductum_operator_token'
const OPERATOR_SESSION_ID_PREFIX = 'dos_'
const OPERATOR_SESSION_PUBLIC_ID_PREFIX = 'ops_'
const DEFAULT_OPERATOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export interface AuthenticatedOperatorSession {
  id: string
  actor: string
  scopes: OperatorSessionScope[]
  projectIds: ProjectId[] | null
}

interface MemoryOperatorSessionRecord extends OperatorSessionRecord {
  expiresAtMs: number
}

interface MintOperatorSessionInput {
  operatorToken: string
  nowMs: number
  actor?: string
  scopes?: OperatorSessionScope[]
  projectIds?: ProjectId[] | null
}

interface LegacyOperatorSessionRecord {
  tokenHash: string
  expiresAtMs: number
}

export class OperatorSessionStore {
  private readonly sessions = new Map<string, MemoryOperatorSessionRecord | LegacyOperatorSessionRecord>()

  constructor(
    private readonly repo?: SqliteOperatorSessionRepo,
    private readonly ttlMs = DEFAULT_OPERATOR_SESSION_TTL_MS,
  ) {}

  mint(input: MintOperatorSessionInput): { sessionId: string; expiresAtMs: number; session: PublicOperatorSession } {
    this.prune(input.nowMs)
    const sessionId = `${OPERATOR_SESSION_ID_PREFIX}${randomBytes(32).toString('base64url')}`
    const publicId = `${OPERATOR_SESSION_PUBLIC_ID_PREFIX}${randomBytes(12).toString('base64url')}`
    const expiresAtMs = input.nowMs + this.ttlMs
    const record = {
      id: publicId,
      tokenHash: hashToken(sessionId),
      operatorTokenHash: hashToken(input.operatorToken),
      actor: normalizedActor(input.actor, publicId),
      scopes: normalizeScopes(input.scopes),
      projectIds: input.projectIds ?? null,
      createdAt: new Date(input.nowMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      revokedAt: null,
      lastSeenAt: null,
    } satisfies OperatorSessionRecord
    if (this.repo != null) {
      return { sessionId, expiresAtMs, session: publicOperatorSession(this.repo.create(record)) }
    }
    this.sessions.set(record.tokenHash, { ...record, expiresAtMs })
    return { sessionId, expiresAtMs, session: publicOperatorSession(record) }
  }

  validate(input: { sessionId: string; operatorToken: string; nowMs: number }): boolean {
    return this.authenticate(input) != null
  }

  authenticate(input: { sessionId: string; operatorToken: string; nowMs: number }): AuthenticatedOperatorSession | null {
    const tokenHash = hashToken(input.sessionId)
    const operatorTokenHash = hashToken(input.operatorToken)
    const record = this.repo?.getByTokenHash(tokenHash) ?? this.sessions.get(tokenHash)
    if (record == null) return null
    if ('revokedAt' in record && record.revokedAt != null) return null
    const expiresAtMs = 'expiresAtMs' in record ? record.expiresAtMs : Date.parse(record.expiresAt)
    if (expiresAtMs <= input.nowMs) {
      this.sessions.delete(tokenHash)
      return null
    }
    if ('operatorTokenHash' in record && !hashesMatch(record.operatorTokenHash, operatorTokenHash)) return null
    if (!('operatorTokenHash' in record) && !hashesMatch(record.tokenHash, operatorTokenHash)) return null
    const lastSeenAt = new Date(input.nowMs).toISOString()
    if (this.repo != null && 'id' in record) this.repo.touch(record.id, lastSeenAt)
    else if ('lastSeenAt' in record) record.lastSeenAt = lastSeenAt
    if (!('id' in record)) return { id: 'legacy-browser-session', actor: 'local-operator', scopes: ['operator'], projectIds: null }
    return { id: record.id, actor: record.actor, scopes: record.scopes, projectIds: record.projectIds }
  }

  revoke(sessionId: string | null | undefined): void {
    if (sessionId == null || sessionId === '') return
    const tokenHash = hashToken(sessionId)
    const record = this.repo?.getByTokenHash(tokenHash) ?? null
    if (record != null) this.repo?.revoke(record.id, new Date().toISOString())
    this.sessions.delete(tokenHash)
  }

  revokeById(id: string, nowMs: number): PublicOperatorSession | null {
    if (this.repo == null) {
      for (const record of this.sessions.values()) {
        if ('id' in record && record.id === id) {
          record.revokedAt = new Date(nowMs).toISOString()
          return publicOperatorSession(record)
        }
      }
      return null
    }
    const revoked = this.repo.revoke(id, new Date(nowMs).toISOString())
    return revoked == null ? null : publicOperatorSession(revoked)
  }

  list(nowMs: number, limit = 100): PublicOperatorSession[] {
    this.prune(nowMs)
    if (this.repo != null) return this.repo.list(limit)
    return [...this.sessions.values()]
      .filter((record): record is MemoryOperatorSessionRecord => 'id' in record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map(publicOperatorSession)
  }

  prune(nowMs: number): void {
    this.repo?.pruneExpired(new Date(nowMs).toISOString())
    for (const [sessionId, record] of this.sessions) {
      if (record.expiresAtMs <= nowMs) this.sessions.delete(sessionId)
    }
  }
}

export function shouldUseSecureCookie(c: Context): boolean {
  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (forwardedProto === 'https') return true
  if (forwardedProto === 'http') return false
  try {
    return new URL(c.req.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function serializeOperatorCookie(value: string, secure: boolean, maxAgeSeconds = Math.floor(DEFAULT_OPERATOR_SESSION_TTL_MS / 1000)): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join('; ')
}

export function clearOperatorCookie(secure: boolean): string {
  return [
    `${COOKIE_NAME}=`,
    'Path=/api',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    'Max-Age=0',
  ].join('; ')
}

export function readOperatorCookie(header: string): string | null {
  return readCookie(header, COOKIE_NAME)
}

function normalizedActor(actor: string | null | undefined, sessionId: string): string {
  const trimmed = actor?.trim()
  const base = trimmed == null || trimmed === '' ? 'local-session' : trimmed
  return `${base}#${sessionId.slice(OPERATOR_SESSION_PUBLIC_ID_PREFIX.length, OPERATOR_SESSION_PUBLIC_ID_PREFIX.length + 8)}`
}

function normalizeScopes(scopes: readonly OperatorSessionScope[] | null | undefined): OperatorSessionScope[] {
  if (scopes == null || scopes.length === 0) return ['operator']
  const allowed = new Set<OperatorSessionScope>(['read', 'approver', 'operator'])
  const out = [...new Set(scopes)].filter((scope) => allowed.has(scope))
  return out.length === 0 ? ['read'] : out
}

function readCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    if (key !== name) continue
    const raw = part.slice(index + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function hashesMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}
