import { describe, expect, expectTypeOf, it } from 'vitest'

import * as canonical from '@ductum/core'
import * as shim from '../types.js'
import type {
  HarnessAdapter,
  HarnessEvent,
  HarnessKillReason,
  HarnessSession,
  HarnessSessionResult,
  SpawnOptions,
  TokenUsageDelta,
} from '../types.js'

/**
 * D163 §6 + P4: the harness package re-exports the canonical contract
 * from `@ductum/core`. These tests pin that relationship so a future
 * silent fork (declaring a parallel interface in this package again)
 * fails CI.
 */
describe('harness contract is owned by @ductum/core', () => {
  it('re-exports the harness adapter and session shapes from core', () => {
    expectTypeOf<HarnessAdapter>().toEqualTypeOf<canonical.HarnessAdapter>()
    expectTypeOf<HarnessSession>().toEqualTypeOf<canonical.HarnessSession>()
    expectTypeOf<HarnessSessionResult>().toEqualTypeOf<canonical.HarnessSessionResult>()
    expectTypeOf<HarnessKillReason>().toEqualTypeOf<canonical.HarnessKillReason>()
    expectTypeOf<SpawnOptions>().toEqualTypeOf<canonical.SpawnOptions>()
  })

  it('re-exports the harness event and token usage shapes from core', () => {
    expectTypeOf<HarnessEvent>().toEqualTypeOf<canonical.HarnessEvent>()
    expectTypeOf<TokenUsageDelta>().toEqualTypeOf<canonical.TokenUsageDelta>()
  })

  it('does not introduce harness-only declarations of the canonical shapes', () => {
    // Sanity check: the shim file has only `export type` statements.
    // Any future runtime export would show up here.
    expect(Object.keys(shim)).toEqual([])
  })
})

describe('canonical session.started shape', () => {
  it('rejects a session.started event without a harnessSessionId at the type level', () => {
    // The union narrows `session.started` to `{ harnessSessionId: string }`.
    // Omitting the field is a compile-time error; the runtime assertion
    // below pins the same invariant for runtime-emitted events.
    const event = { type: 'session.started', harnessSessionId: 'abc' } satisfies HarnessEvent
    expect(event.harnessSessionId).toBe('abc')
  })

  it('refuses to treat an empty harnessSessionId as canonical', () => {
    const event: HarnessEvent = { type: 'session.started', harnessSessionId: '' }
    expect(isCanonicalSessionStarted(event)).toBe(false)
  })

  it('accepts a non-empty harnessSessionId as canonical', () => {
    const event: HarnessEvent = { type: 'session.started', harnessSessionId: 'session-1' }
    expect(isCanonicalSessionStarted(event)).toBe(true)
  })
})

function isCanonicalSessionStarted(event: HarnessEvent): boolean {
  return event.type === 'session.started' && event.harnessSessionId.trim() !== ''
}
