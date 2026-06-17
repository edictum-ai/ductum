import { describe, expect, it } from 'vitest'

import type { EnrichedRun } from '@/api/client'
import {
  computeLineageStage,
  lineageSegmentClass,
  LINEAGE_STAGE_ORDER,
} from '@/lib/lineage-stage'

function makeRun(overrides: Partial<EnrichedRun> & { taskName: string }): EnrichedRun {
  const base = {
    id: 'run-' + Math.random().toString(36).slice(2, 8),
    taskId: 'task-' + Math.random().toString(36).slice(2, 8),
    agentId: 'agent-1',
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    specName: 'spec',
    projectName: 'project',
    agentName: 'agent',
    agentModel: 'model',
    retryCount: 0,
  }
  return { ...base, ...overrides } as EnrichedRun
}

describe('computeLineageStage', () => {
  it('returns understand for an empty lineage', () => {
    expect(computeLineageStage([])).toBe('understand')
  })

  it('reports understand while the impl run is still gathering context', () => {
    expect(
      computeLineageStage([makeRun({ taskName: 'P1', stage: 'understand' })]),
    ).toBe('understand')
  })

  it('reports implement once the impl run starts coding', () => {
    expect(
      computeLineageStage([makeRun({ taskName: 'P1', stage: 'implement' })]),
    ).toBe('implement')
  })

  it('reports review when a review run exists alongside the impl run', () => {
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'implement' }),
        makeRun({ taskName: 'review-P1', stage: 'understand' }),
      ]),
    ).toBe('review')
  })

  it('reports review when a fix run exists alongside the impl run', () => {
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'implement' }),
        makeRun({ taskName: 'fix-P1-r1', stage: 'implement' }),
      ]),
    ).toBe('review')
  })

  it('reports ship when the impl run reaches the ship stage', () => {
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'ship', pendingApproval: true }),
      ]),
    ).toBe('ship')
  })

  it('reports done when any run in the lineage is done', () => {
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'done' }),
      ]),
    ).toBe('done')
  })

  it('keeps reporting done even when other lineage runs are still running', () => {
    // The impl run shipped + done; a stale review run is still ticking.
    // The lineage as a whole is done from the operator perspective.
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'done' }),
        makeRun({ taskName: 'review-P1', stage: 'implement' }),
      ]),
    ).toBe('done')
  })

  it('reports failed when every run in the lineage is terminal-failed', () => {
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'implement', terminalState: 'failed' }),
        makeRun({ taskName: 'fix-P1-r1', stage: 'implement', terminalState: 'failed' }),
      ]),
    ).toBe('failed')
  })

  it('takes the FURTHEST live run when multiple non-terminal runs disagree', () => {
    // impl run is at 'understand' (it just got dispatched), but a fix
    // run from a previous lineage round is at 'implement' (re-running
    // after a review failure). The lineage is in the review phase.
    expect(
      computeLineageStage([
        makeRun({ taskName: 'P1', stage: 'understand' }),
        makeRun({ taskName: 'fix-P1-r1', stage: 'implement' }),
      ]),
    ).toBe('review')
  })
})

describe('lineageSegmentClass', () => {
  it('green for done segments', () => {
    expect(lineageSegmentClass('understand', 'review')).toContain('emerald')
    expect(lineageSegmentClass('implement', 'review')).toContain('emerald')
  })

  it('blue for the active segment', () => {
    expect(lineageSegmentClass('review', 'review')).toContain('blue')
  })

  it('grey for future segments', () => {
    expect(lineageSegmentClass('ship', 'review')).toContain('muted')
    expect(lineageSegmentClass('done', 'review')).toContain('muted')
  })

  it('red across the whole bar when the lineage failed', () => {
    for (const segment of LINEAGE_STAGE_ORDER) {
      expect(lineageSegmentClass(segment, 'failed')).toContain('red')
    }
  })

  it('green across the whole bar when the lineage is done', () => {
    for (const segment of LINEAGE_STAGE_ORDER) {
      expect(lineageSegmentClass(segment, 'done')).toContain('emerald')
    }
  })
})
