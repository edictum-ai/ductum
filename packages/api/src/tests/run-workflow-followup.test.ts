import { createId, type Run, type Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { openWorkflowFollowupForRun } from '../lib/run-workflow-followup.js'

const specId = createId<'SpecId'>()

describe('openWorkflowFollowupForRun', () => {
  it('prefers an actionable review over an older open fix task', () => {
    const impl = task('impl', 'P2-CORRECTION-VERBS', 'done')
    const oldFix = task('fix-1', 'fix-P2-CORRECTION-VERBS-r1', 'active')
    const currentFix = task('fix-2', 'fix-P2-CORRECTION-VERBS-r2', 'active')
    const review = task('review-3', 'review-P2-CORRECTION-VERBS-r3', 'ready')
    const tasks = [impl, oldFix, currentFix, review]

    expect(openWorkflowFollowupForRun(repo(tasks), { taskId: currentFix.id })).toBe('review')
  })
})

function repo(tasks: Task[]) {
  return {
    get: (id: Run['taskId']) => tasks.find((item) => item.id === id) ?? null,
    list: () => tasks,
  }
}

function task(id: string, name: string, status: Task['status']): Task {
  return {
    id: id as Task['id'],
    specId,
    targetId: null,
    repositoryId: null,
    componentId: null,
    name,
    prompt: name,
    repos: [],
    assignedAgentId: null,
    requiredRole: name.startsWith('review-') ? 'reviewer' : name.startsWith('fix-') ? 'builder' : null,
    complexity: null,
    status,
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  }
}
