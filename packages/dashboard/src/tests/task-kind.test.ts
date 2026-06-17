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
})
