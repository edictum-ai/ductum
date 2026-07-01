import { describe, expect, it } from 'vitest'

import { isUnattendedApprovalBlockedReason } from '../index.js'

describe('unattended approval blocked reason', () => {
  it('accepts current and legacy unattended policy block prefixes', () => {
    expect(isUnattendedApprovalBlockedReason('Action Needed: unattended approval blocked: git clean state is unknown')).toBe(true)
    expect(isUnattendedApprovalBlockedReason('Needs Attention: unattended approval blocked: git clean state is unknown')).toBe(true)
    expect(isUnattendedApprovalBlockedReason('operator paused for scope review')).toBe(false)
  })
})
