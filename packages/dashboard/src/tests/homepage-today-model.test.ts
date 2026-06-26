import { describe, expect, it } from 'vitest'

import { buildHomeVerdict } from '@/components/homepage/homepage-today-model'
import type { OperatorProgressSnapshot } from '@/lib/operator-progress'

describe('buildHomeVerdict', () => {
  it('prioritizes repair blockers over active runs, approvals, and ready tasks', () => {
    const verdict = buildHomeVerdict(snapshot({
      activeRuns: 2,
      approvalsWaiting: 1,
      readyTasks: 3,
      needsOperator: 1,
    }), 0)

    expect(verdict.text).toBe('Factory needs you · no tasks yet · 1 needs you · $0.00/wk')
  })

  it('keeps approval-first wording when no repair blockers exist', () => {
    const verdict = buildHomeVerdict(snapshot({
      activeRuns: 1,
      approvalsWaiting: 1,
      readyTasks: 2,
      needsOperator: 0,
    }), 0)

    expect(verdict.text).toBe('Factory running · no tasks yet · 1 awaiting approval · $0.00/wk')
  })
})

function snapshot(overrides: Partial<OperatorProgressSnapshot>): OperatorProgressSnapshot {
  return {
    taskTotal: 0,
    runTotal: 0,
    taskCounts: {
      pending: 0,
      ready: 0,
      blocked: 0,
      active: 0,
      done: 0,
      failed: 0,
    },
    activeRuns: 0,
    approvalsWaiting: 0,
    readyTasks: 0,
    needsOperator: 0,
    integrityIssues: 0,
    readiness: 'clear',
    taskModes: {
      orchestrated: 0,
      external: 0,
      recorded: 0,
      unknown: 0,
      inconsistent: 0,
    },
    runModes: {
      orchestrated: 0,
      external: 0,
      recorded: 0,
      unknown: 0,
      inconsistent: 0,
    },
    issueSamples: [],
    issuesTruncated: false,
    externalCount: 0,
    recordedCount: 0,
    ...overrides,
  }
}
