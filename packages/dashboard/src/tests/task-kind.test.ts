import { describe, expect, it } from 'vitest'

import { classifyTaskKind } from '@/lib/task-kind'

describe('classifyTaskKind', () => {
  it('requires both lineage-shaped name and expected role for review-loop tasks', () => {
    expect(classifyTaskKind({ name: 'review-P1', requiredRole: 'reviewer' }).kind).toBe('review')
    expect(classifyTaskKind({ name: 'fix-P1-r1', requiredRole: 'builder' }).kind).toBe('fix')
    expect(classifyTaskKind({ name: 'review-release-notes', requiredRole: null }).kind).toBe('impl')
    expect(classifyTaskKind({ name: 'review-P1', requiredRole: 'builder' }).kind).toBe('impl')
    expect(classifyTaskKind({ name: 'fix-P1-r1', requiredRole: 'reviewer' }).kind).toBe('impl')
    expect(classifyTaskKind({ name: undefined, requiredRole: 'reviewer' }).kind).toBe('impl')
  })

  it('classifies redacted review-loop tasks from prompt wrappers and expected roles', () => {
    const review = classifyTaskKind({
      name: '[redacted]',
      requiredRole: 'reviewer',
      prompt: '## Review Task\n\n### Original Task\n# P1: Safe task',
    })
    expect(review.kind).toBe('review')
    expect(review.roleCode).toBe('R1')

    const fix = classifyTaskKind({
      name: '[redacted]',
      requiredRole: 'builder',
      prompt: '## Fix Task (Review Round 2)\n\n### Original Task\n# P1: Safe task',
    })
    expect(fix.kind).toBe('fix')
    expect(fix.roleCode).toBe('F2')

    const warningCleanup = classifyTaskKind({
      name: '[redacted]',
      requiredRole: 'builder',
      prompt: '## Warning Cleanup Task (Review Round 1)\n\n### Original Task\n# P1: Safe task',
    })
    expect(warningCleanup.kind).toBe('fix')
    expect(warningCleanup.roleCode).toBe('F1')
  })

  it('does not classify prompt wrappers as review-loop tasks when the role does not match', () => {
    expect(classifyTaskKind({ name: '[redacted]', requiredRole: 'builder', prompt: '## Review Task\n\nBody.' }).kind).toBe('impl')
    expect(classifyTaskKind({ name: '[redacted]', requiredRole: 'reviewer', prompt: '## Fix Task (Review Round 1)\n\nBody.' }).kind).toBe('impl')
  })
})
