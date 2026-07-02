import { describe, expect, it } from 'vitest'

import { decisionActorLabel, shortHostPath } from '@/lib/display'

describe('display helpers', () => {
  it('shortens local host paths without destroying raw copy values', () => {
    expect(shortHostPath('/Users/arnold/project/ductum/packages/dashboard')).toBe('ductum/packages/dashboard')
    expect(shortHostPath('/Users/arnold/.ductum/factories/factory/ductum/.ductum/worktrees/ductum/P3-demo/ductum/src')).toBe('P3-demo/ductum/src')
    expect(shortHostPath('/tmp/ductum/worktrees/run_abc123')).toBe('worktrees/run_abc123')
    expect(shortHostPath('/Users/arnold/Downloads/key.pem')).toBe('~/Downloads/key.pem')
  })

  it('uses explicit actor labels for unknown and system decisions', () => {
    expect(decisionActorLabel('telegram:arnold')).toBe('by telegram:arnold')
    expect(decisionActorLabel('')).toBe('actor unknown')
    expect(decisionActorLabel(null)).toBe('actor unknown')
    expect(decisionActorLabel('system')).toBe('system actor')
  })
})
