import { randomBytes } from 'node:crypto'

export const WELCOME_HANDOFF_TTL_MS = 60_000

export interface HandoffTokenEntry {
  token: string
  factoryId: string
  operatorToken: string
  expiresAtMs: number
  consumedAtMs?: number
}

export type HandoffConsumeResult =
  | { ok: true; operatorToken: string; expiresAtMs: number }
  | { ok: false; reason: 'missing' | 'consumed' | 'expired' | 'factory_mismatch' }

// P3 starts one API process for one local factory. A clustered serve would
// need a shared store so mint and exchange land in the same token table.
export class HandoffTokenStore {
  private readonly entries = new Map<string, HandoffTokenEntry>()

  constructor(private readonly ttlMs = WELCOME_HANDOFF_TTL_MS) {}

  mint(input: {
    factoryId: string
    operatorToken: string
    nowMs: number
  }): { token: string; expiresAtMs: number } {
    this.prune(input.nowMs)
    let token = randomBytes(32).toString('base64url')
    while (this.entries.has(token)) token = randomBytes(32).toString('base64url')
    const expiresAtMs = input.nowMs + Math.min(this.ttlMs, WELCOME_HANDOFF_TTL_MS)
    this.entries.set(token, {
      token,
      factoryId: input.factoryId,
      operatorToken: input.operatorToken,
      expiresAtMs,
    })
    return { token, expiresAtMs }
  }

  consume(input: { token: string; factoryId: string; nowMs: number }): HandoffConsumeResult {
    const entry = this.entries.get(input.token)
    if (entry == null) return { ok: false, reason: 'missing' }
    if (entry.consumedAtMs != null) return { ok: false, reason: 'consumed' }
    if (entry.expiresAtMs < input.nowMs) {
      this.entries.delete(input.token)
      return { ok: false, reason: 'expired' }
    }
    if (entry.factoryId !== input.factoryId) return { ok: false, reason: 'factory_mismatch' }
    entry.consumedAtMs = input.nowMs
    return { ok: true, operatorToken: entry.operatorToken, expiresAtMs: entry.expiresAtMs }
  }

  private prune(nowMs: number): void {
    for (const [token, entry] of this.entries) {
      if (entry.expiresAtMs < nowMs) this.entries.delete(token)
    }
  }
}
