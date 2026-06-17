import { describe, expect, it } from 'vitest'

import { runCost, runDisplayStatus, runNeedsAttention, runStatusLabel, runStatusTone } from '@/lib/run-presentation'

describe('run presentation contract', () => {
  it('falls back to local derivation when the backend omits ui (legacy data)', () => {
    // Runs persisted before the UI contract shipped have no `ui` field. The
    // dashboard MUST still render them — D163 §1 keeps the local derivation
    // path strictly as a compatibility fallback.
    const run = {
      stage: 'ship',
      terminalState: null,
      pendingApproval: true,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    } as const

    expect(runDisplayStatus(run)).toBe('awaiting_approval')
    expect(runStatusLabel(run)).toBe('Awaiting approval')
    expect(runStatusTone(run)).toBe('accent')
    expect(runNeedsAttention(run)).toBe(false)
    expect(runCost(run)).toEqual({ usd: 0, label: 'pending', state: 'pending' })
  })

  it('uses backend UI contract fields before local fallback derivation', () => {
    const run = {
      stage: 'implement',
      terminalState: null,
      pendingApproval: false,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      ui: {
        schemaVersion: 'ductum.ui.run.v1',
        status: {
          key: 'failed',
          label: 'Failed',
          tone: 'err',
          terminal: true,
          needsAttention: true,
        },
        cost: {
          usd: 2.5,
          label: '$2.50',
          state: 'measured',
        },
        href: '/qratum/milestone-a/P1/run-1',
      },
    } as const

    expect(runDisplayStatus(run)).toBe('failed')
    expect(runStatusLabel(run)).toBe('Failed')
    expect(runStatusTone(run)).toBe('err')
    expect(runNeedsAttention(run)).toBe(true)
    expect(runCost(run)).toEqual({ usd: 2.5, label: '$2.50', state: 'measured' })
  })
})
