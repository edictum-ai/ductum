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

  it('surfaces an unknown-cost run (tokens but $0) as unmeasured, not free', () => {
    // The model had no pricing rates, so cost is unknown. The dashboard
    // must say "unmeasured" — never "$0"/"<$0.01" measured, which reads
    // as free. (A priced model always yields >0 for any tokens.)
    const run = {
      stage: 'done',
      terminalState: null,
      pendingApproval: false,
      costUsd: 0,
      tokensIn: 5000,
      tokensOut: 1200,
    } as const

    expect(runCost(run)).toEqual({ usd: 0, label: 'unmeasured', state: 'unmeasured' })
  })

  it('still shows a real measured sub-cent cost as measured', () => {
    // usd > 0 (however small) is a genuine measurement and stays measured.
    const run = {
      stage: 'done',
      terminalState: null,
      pendingApproval: false,
      costUsd: 0.003,
      tokensIn: 100,
      tokensOut: 50,
    } as const

    const cost = runCost(run)
    expect(cost.state).toBe('measured')
    expect(cost.label).toBe('<$0.01')
  })
})
