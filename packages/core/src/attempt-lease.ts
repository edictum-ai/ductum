import { hostname } from 'node:os'

import type { RunId } from './types.js'

export type AttemptLeaseStatus = 'active' | 'released' | 'expired'
export type FencingToken = number

export interface AttemptLease {
  attemptId: string
  runId: RunId
  sessionId: string | null
  ownerProcessId: string
  fenceToken: FencingToken
  status: AttemptLeaseStatus
  expiresAt: string
  renewedAt: string
  releasedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AcquireAttemptLeaseInput {
  attemptId: string
  runId: RunId
  sessionId?: string | null
  ownerProcessId: string
  ttlMs: number
  now?: Date
}

export interface RenewAttemptLeaseInput {
  runId: RunId
  fenceToken: FencingToken
  ttlMs: number
  now?: Date
}

export interface ReleaseAttemptLeaseInput {
  runId: RunId
  fenceToken: FencingToken
  now?: Date
}

export class StaleFenceError extends Error {
  constructor(
    readonly runId: RunId,
    readonly fenceToken: FencingToken,
    message?: string,
  ) {
    super(message ?? `Stale fence token ${fenceToken} rejected for run ${runId}`)
    this.name = 'StaleFenceError'
  }
}

export function isStaleFenceError(error: unknown): error is StaleFenceError {
  return error instanceof StaleFenceError
}

const OWNER_STARTED_AT = new Date().toISOString()

export function createAttemptLeaseOwnerProcessId(): string {
  return `${hostname()}:pid-${process.pid}:started-${OWNER_STARTED_AT}`
}
