import { describe, expect, it } from 'vitest'

import {
  countByDisplayStatus,
  DISPLAY_STATUS_LABEL,
  deriveDisplayStatus,
} from '../run-display.js'
import type { Run } from '../types.js'

function baseRun(overrides: Partial<Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'>>): Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'> {
  return {
    stage: 'implement',
    terminalState: null,
    pendingApproval: false,
    ...overrides,
  }
}

describe('deriveDisplayStatus', () => {
  it('returns running for a non-terminal implementation run', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'implement' }))).toBe('running')
  })

  it('returns running for a run in ship without pending approval', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'ship', pendingApproval: false }))).toBe('running')
  })

  it('returns awaiting_approval for ship + pendingApproval', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'ship', pendingApproval: true }))).toBe('awaiting_approval')
  })

  it('returns done for inconsistent done + pendingApproval state', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'done', pendingApproval: true }))).toBe('done')
  })

  it('only treats ship-stage pending approval as awaiting approval', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'implement', pendingApproval: true }))).toBe('running')
  })

  it('returns done when stage === done', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'done' }))).toBe('done')
  })

  it('returns failed when terminalState === failed, regardless of stage', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'ship', terminalState: 'failed' }))).toBe('failed')
    expect(deriveDisplayStatus(baseRun({ stage: 'understand', terminalState: 'failed', pendingApproval: true }))).toBe('failed')
  })

  it('returns stalled when terminalState === stalled', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'implement', terminalState: 'stalled' }))).toBe('stalled')
  })

  it('returns cancelled when terminalState === cancelled', () => {
    expect(deriveDisplayStatus(baseRun({ stage: 'ship', terminalState: 'cancelled', pendingApproval: true }))).toBe('cancelled')
  })

  it('prefers failed over stalled if both somehow leak through', () => {
    // Defensive: if a future bug sets both, we surface the more severe
    // state to the user so they investigate rather than wait.
    expect(deriveDisplayStatus(baseRun({ stage: 'implement', terminalState: 'failed' }))).toBe('failed')
  })

  describe('#275 completion-aware display status', () => {
    it('returns awaiting_review when completionSummary is set and stage is not done', () => {
      // Pins the post-completion truth: once the agent has called
      // ductum.complete, the run is no longer "running" from the
      // operator POV even if the workflow has not advanced to 'done'.
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement' }), completionSummary: 'shipped the feature' })).toBe('awaiting_review')
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'ship' }), completionSummary: 'shipped the feature' })).toBe('awaiting_review')
    })

    it('returns done over awaiting_review when stage is done even if completionSummary is set', () => {
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'done' }), completionSummary: 'shipped' })).toBe('done')
    })

    it('returns awaiting_approval over awaiting_review for ship + pendingApproval with completionSummary', () => {
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'ship', pendingApproval: true }), completionSummary: 'shipped' })).toBe('awaiting_approval')
    })

    it('treats an empty/whitespace completionSummary as no completion', () => {
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement' }), completionSummary: '' })).toBe('running')
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement' }), completionSummary: '   ' })).toBe('running')
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement' }), completionSummary: null })).toBe('running')
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement' }), completionSummary: undefined })).toBe('running')
    })

    it('still respects terminal state when completionSummary is set', () => {
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement', terminalState: 'failed' }), completionSummary: 'partial' })).toBe('failed')
      expect(deriveDisplayStatus({ ...baseRun({ stage: 'implement', terminalState: 'cancelled' }), completionSummary: 'partial' })).toBe('cancelled')
    })
  })
})

describe('countByDisplayStatus', () => {
  it('aggregates counts across a mixed set of runs', () => {
    const runs = [
      baseRun({ stage: 'understand' }),
      baseRun({ stage: 'implement' }),
      baseRun({ stage: 'ship', pendingApproval: true }),
      baseRun({ stage: 'ship', pendingApproval: true }),
      baseRun({ stage: 'done' }),
      baseRun({ stage: 'implement', terminalState: 'failed' }),
      baseRun({ stage: 'implement', terminalState: 'stalled' }),
      baseRun({ stage: 'ship', terminalState: 'cancelled' }),
      baseRun({ stage: 'implement', terminalState: 'paused' }),
      baseRun({ stage: 'implement', terminalState: 'frozen' }),
      baseRun({ stage: 'implement', terminalState: 'quarantined' }),
    ]

    expect(countByDisplayStatus(runs)).toEqual({
      running: 2,
      awaiting_review: 0,
      awaiting_approval: 2,
      failed: 1,
      stalled: 1,
      cancelled: 1,
      paused: 1,
      frozen: 1,
      quarantined: 1,
      done: 1,
    })
  })

  it('returns all zeros for an empty list', () => {
    expect(countByDisplayStatus([])).toEqual({
      running: 0,
      awaiting_review: 0,
      awaiting_approval: 0,
      failed: 0,
      stalled: 0,
      cancelled: 0,
      paused: 0,
      frozen: 0,
      quarantined: 0,
      done: 0,
    })
  })
})

describe('DISPLAY_STATUS_LABEL', () => {
  it('has a human label for every DisplayStatus value', () => {
    expect(DISPLAY_STATUS_LABEL.running).toBeTruthy()
    expect(DISPLAY_STATUS_LABEL.awaiting_review).toBeTruthy()
    expect(DISPLAY_STATUS_LABEL.awaiting_approval).toBeTruthy()
    expect(DISPLAY_STATUS_LABEL.failed).toBeTruthy()
    expect(DISPLAY_STATUS_LABEL.stalled).toBeTruthy()
    expect(DISPLAY_STATUS_LABEL.cancelled).toBeTruthy()
    expect(DISPLAY_STATUS_LABEL.done).toBeTruthy()
  })
})
