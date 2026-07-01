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

  it('points implementation agents at the run working directory when one exists', () => {
    const prompt = buildDispatcherSystemPrompt(task({ repos: ['/Users/acartagena/project/ductum'] }), {
      workingDir: '/Users/acartagena/.ductum/factories/demo/.ductum/worktrees/ductum/run/ductum',
    })

    expect(prompt).toContain('Use this run working directory for all file reads and writes')
    expect(prompt).toContain('/Users/acartagena/.ductum/factories/demo/.ductum/worktrees/ductum/run/ductum')
    expect(prompt).toContain('Do not use original repository source paths as workspaces')
    expect(prompt).not.toContain('## Repo Scope\n/Users/acartagena/project/ductum')
  })

  it('tells review and fix agents not to push or merge', () => {
    const review = buildReviewPrompt(task(), 'diff --git a/file b/file', 'tests passed')
    const fix = buildFixPrompt(task(), 'FAIL: missing assertion', 1)

    expect(review).toContain('Do not edit, push, approve, or merge')
    expect(fix).toContain('Do not push branches or merge')
  })
})

function task(overrides: Partial<Task> = {}): Task {
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
    ...overrides,
  }
}
