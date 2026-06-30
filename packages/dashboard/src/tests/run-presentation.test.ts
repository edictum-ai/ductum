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

  it('surfaces a no-price run (tokens but $0) as missing price, not free', () => {
    // The model had no pricing rate, so cost is unknown even though usage
    // is known. The dashboard must say "missing price" — never "$0"/"<$0.01".
    const run = {
      stage: 'done',
      terminalState: null,
      pendingApproval: false,
      costUsd: 0,
      tokensIn: 5000,
      tokensOut: 1200,
    } as const

    expect(runCost(run)).toEqual({ usd: 0, label: 'missing price', state: 'unpriced' })
  })

  it('surfaces a scan-miss run (no tokens, terminal) as missing usage', () => {
    // No usage was ever reported — distinct from unpriced (which has
    // usage). Terminal so it is not 'pending'.
    const run = {
      stage: 'done',
      terminalState: 'completed',
      pendingApproval: false,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    } as const

    expect(runCost(run)).toEqual({ usd: 0, label: 'missing usage', state: 'unmeasured' })
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

  it('derives quarantined and frozen terminal states and flags them needs-attention', () => {
    // No backend ui contract on these runs — the local fallback derivation
    // must still surface the new poison/halt states (design/04 §5 inbox).
    const quarantined = { stage: 'implement', terminalState: 'quarantined', pendingApproval: false } as const
    expect(runDisplayStatus(quarantined)).toBe('quarantined')
    expect(runStatusLabel(quarantined)).toBe('Quarantined')
    expect(runStatusTone(quarantined)).toBe('err')
    expect(runNeedsAttention(quarantined)).toBe(true)

    const frozen = { stage: 'implement', terminalState: 'frozen', pendingApproval: false } as const
    expect(runDisplayStatus(frozen)).toBe('frozen')
    expect(runNeedsAttention(frozen)).toBe(true)
  })
})
