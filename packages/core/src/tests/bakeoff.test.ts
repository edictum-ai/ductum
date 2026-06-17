import { describe, expect, it } from 'vitest'

import {
  BAKEOFF_SPEC_MARKER,
  isBakeoffBlindReviewTask,
  isBakeoffCandidateTask,
  isBakeoffSpec,
} from '../bakeoff.js'
import type { Spec, Task } from '../types.js'

describe('typed bakeoff detection', () => {
  it('uses spec strategy instead of bakeoff-looking text', () => {
    expect(isBakeoffSpec(spec({ strategy: 'best_of_n' }))).toBe(true)
    expect(isBakeoffSpec(spec({
      name: 'bakeoff demo',
      document: BAKEOFF_SPEC_MARKER,
      strategy: 'normal',
    }))).toBe(false)
  })

  it('uses task strategy role instead of task names', () => {
    const bestOfN = spec({ strategy: 'best_of_n' })

    expect(isBakeoffCandidateTask(bestOfN, task({ strategyRole: 'candidate' }))).toBe(true)
    expect(isBakeoffCandidateTask(bestOfN, task({ name: 'candidate-codex' }))).toBe(false)
    expect(isBakeoffBlindReviewTask(bestOfN, task({ strategyRole: 'blind_review' }))).toBe(true)
    expect(isBakeoffBlindReviewTask(bestOfN, task({ name: 'blind-review' }))).toBe(false)
  })
})

function spec(overrides: Partial<Spec> = {}): Spec {
  return {
    id: overrides.id ?? 'spec-1' as Spec['id'],
    projectId: overrides.projectId ?? 'project-1' as Spec['projectId'],
    name: overrides.name ?? 'Spec',
    status: overrides.status ?? 'approved',
    strategy: overrides.strategy ?? 'normal',
    strategyConfig: overrides.strategyConfig ?? null,
    document: overrides.document ?? '# Spec',
    maxFixIterations: overrides.maxFixIterations ?? null,
    createdAt: overrides.createdAt ?? '2026-06-13T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-13T00:00:00.000Z',
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Task['id'],
    specId: 'spec-1' as Task['specId'],
    targetId: null,
    name: 'Task',
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'pending',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
  }
}
