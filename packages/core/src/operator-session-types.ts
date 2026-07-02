import type { ProjectId } from './types.js'

export type OperatorSessionScope = 'read' | 'approver' | 'operator'

export interface OperatorSessionInput {
  id: string
  tokenHash: string
  operatorTokenHash: string
  actor: string
  scopes: OperatorSessionScope[]
  projectIds: ProjectId[] | null
  createdAt: string
  expiresAt: string
  revokedAt?: string | null
  lastSeenAt?: string | null
}

export interface OperatorSessionRecord extends OperatorSessionInput {
  revokedAt: string | null
  lastSeenAt: string | null
}

export interface PublicOperatorSession {
  id: string
  actor: string
  scopes: OperatorSessionScope[]
  projectIds: ProjectId[] | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastSeenAt: string | null
}

export function publicOperatorSession(session: OperatorSessionRecord): PublicOperatorSession {
  return {
    id: session.id,
    actor: session.actor,
    scopes: session.scopes,
    projectIds: session.projectIds,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    lastSeenAt: session.lastSeenAt,
  }
}
