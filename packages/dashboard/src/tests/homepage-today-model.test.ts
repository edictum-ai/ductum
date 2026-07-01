import { describe, expect, it } from 'vitest'

import { buildHomeVerdict, homeWorkStateSummary } from '@/components/homepage/homepage-today-model'
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

  it('separates historical task status from current operator work', () => {
    const summary = homeWorkStateSummary(snapshot({
      activeRuns: 0,
      readyTasks: 0,
      taskCounts: {
        pending: 2,
        ready: 4,
        blocked: 3,
        active: 1,
        done: 10,
        failed: 5,
      },
    }))

    expect(summary).toBe('10 done · 8 blocked/failed history · 0 active now · 0 ready')
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
