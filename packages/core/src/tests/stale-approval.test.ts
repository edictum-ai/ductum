import { describe, expect, it } from 'vitest'

import {
  buildStaleApprovalDenyReason,
  buildStaleApprovalFailureReason,
  isStaleApprovalRun,
  parseStaleApprovalFailureReason,
} from '../stale-approval.js'

describe('stale approval helpers', () => {
  it('parses stale approval failure reasons with or without the fail prefix', () => {
    const raw = buildStaleApprovalFailureReason('feature/x', 'main')
    expect(parseStaleApprovalFailureReason(raw)).toEqual({ branch: 'feature/x', base: 'main' })
    expect(parseStaleApprovalFailureReason(`merge failed: ${raw}`)).toEqual({ branch: 'feature/x', base: 'main' })
  })

  it('builds explicit deny reasons from stale approval details', () => {
    expect(buildStaleApprovalDenyReason({ branch: 'feature/x', base: 'main' }))
      .toBe('stale approval: branch feature/x no longer contains current main')
  })

  it('detects approval-ready stale branches from the run snapshot', () => {
    expect(isStaleApprovalRun({
      stage: 'ship',
      terminalState: null,
      pendingApproval: true,
      failReason: `merge failed: ${buildStaleApprovalFailureReason('feature/x', 'main')}`,
    })).toBe(true)
  })
})
