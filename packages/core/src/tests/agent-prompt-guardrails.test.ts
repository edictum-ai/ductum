import { describe, expect, it } from 'vitest'

import { buildDispatcherSystemPrompt } from '../dispatcher-support.js'
import { buildFixPrompt, buildReviewPrompt } from '../post-completion.js'
import { createId, type Task } from '../types.js'

describe('agent prompt guardrails', () => {
  it('tells implementation agents to complete instead of pushing', () => {
    const prompt = buildDispatcherSystemPrompt(task())

    expect(prompt).toContain('Do not push branches or try to merge')
    expect(prompt).toContain('finish with `ductum_complete`')
  })

  it('tells review and fix agents not to push or merge', () => {
    const review = buildReviewPrompt(task(), 'diff --git a/file b/file', 'tests passed')
    const fix = buildFixPrompt(task(), 'FAIL: missing assertion', 1)

    expect(review).toContain('Do not edit, push, approve, or merge')
    expect(fix).toContain('Do not push branches or merge')
  })
})

function task(): Task {
  const now = new Date().toISOString()
  return {
    id: createId<'TaskId'>(),
    specId: createId<'SpecId'>(),
    targetId: null,
    name: 'demo-task',
    prompt: 'Implement the demo task.',
    repos: ['ductum'],
    assignedAgentId: null,
    requiredRole: null,
    complexity: 'simple',
    status: 'ready',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: ['pnpm test'],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}
