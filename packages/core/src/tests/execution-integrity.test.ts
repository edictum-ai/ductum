import { describe, expect, it } from 'vitest'

import {
  evaluateRunExecutionIntegrity,
  evaluateTaskExecutionIntegrity,
  hasDuctumExecutionStart,
  hasDuctumExecutionLineage,
} from '../execution-integrity.js'
import type { Evidence, Run, Spec, Task } from '../types.js'

describe('execution integrity', () => {
  it('requires session, worktree, and commit for Ductum execution lineage', () => {
    expect(hasDuctumExecutionLineage(run())).toBe(true)
    expect(hasDuctumExecutionLineage(run({ sessionId: null }))).toBe(false)
    expect(hasDuctumExecutionLineage(run({ worktreePaths: null }))).toBe(false)
    expect(hasDuctumExecutionLineage(run({ commitSha: null }))).toBe(false)
  })

  it('shows active Ductum sessions as orchestrated before the final commit exists', () => {
    const integrity = evaluateRunExecutionIntegrity(run({ stage: 'implement', commitSha: null }), [])

    expect(hasDuctumExecutionStart(run({ commitSha: null }))).toBe(true)
    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(false)
    expect(integrity.issues).toEqual([])
  })

  it('allows verification evidence on implementation runs that are waiting for review', () => {
    const integrity = evaluateRunExecutionIntegrity(run({ stage: 'implement' }), [
      evidence({ type: 'custom', payload: { kind: 'verify', passed: true, output: 'pnpm test passed' } }),
    ])

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(true)
    expect(integrity.issues).toEqual([])
  })

  it('marks passing evidence on non-done runs as inconsistent without prose inference', () => {
    const integrity = evaluateRunExecutionIntegrity(run({ stage: 'implement' }), [
      evidence({ type: 'custom', payload: { kind: 'internal-review', passed: true } }),
      evidence({ type: 'custom', payload: { note: 'PASS: looks good' } }),
    ])

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.issues.map((issue) => issue.code)).toContain('final_evidence_on_non_done_run')
    expect(integrity.issues.map((issue) => issue.code)).toContain('prose_success_signal_on_non_done_run')
    expect(integrity.hasExternalOutcome).toBe(false)
  })

  it('does not double-count prose on the same structured evidence row', () => {
    const integrity = evaluateRunExecutionIntegrity(run({ stage: 'implement' }), [
      evidence({
        type: 'custom',
        payload: { kind: 'internal-review', passed: true, summary: 'PASS: review passed' },
      }),
    ])

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.issues.map((issue) => issue.code)).toEqual(['final_evidence_on_non_done_run'])
  })

  it('treats failed internal review evidence on failed review runs as truthful', () => {
    const integrity = evaluateRunExecutionIntegrity(run({
      stage: 'understand',
      terminalState: 'failed',
      commitSha: null,
    }), [
      evidence({ payload: { kind: 'internal-review', verdict: 'fail', passed: false } }),
    ])

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.issues).toEqual([])
  })

  it('treats completed internal review evidence as Ductum lineage without a commit', () => {
    const reviewRun = run({ stage: 'done', commitSha: null })
    const integrity = evaluateRunExecutionIntegrity(reviewRun, [
      evidence({ payload: { kind: 'internal-review', verdict: 'warn', passed: false } }),
    ])

    expect(hasDuctumExecutionLineage(reviewRun)).toBe(false)
    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(true)
    expect(integrity.issues).toEqual([])
  })

  it('does not flag completed review tasks when their run has structured review evidence', () => {
    const reviewRun = run({ stage: 'done', commitSha: null })
    const integrity = evaluateTaskExecutionIntegrity(
      baseTask({ name: 'review-P1', status: 'done' }),
      { strategy: 'normal' } as Spec,
      [reviewRun],
      new Map([[reviewRun.id, [evidence({ payload: { kind: 'internal-review', verdict: 'warn', passed: false } })]]]),
    )

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(true)
    expect(integrity.issues).toEqual([])
  })

  it('does not let prose-only PASS evidence make failed work successful', () => {
    const integrity = evaluateRunExecutionIntegrity(run({
      stage: 'implement',
      terminalState: 'failed',
      commitSha: null,
    }), [
      evidence({ type: 'custom', payload: { note: 'PASS: tests looked good in a note' } }),
    ])

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.hasExternalOutcome).toBe(false)
    expect(integrity.externalOutcome).toBe(null)
    expect(integrity.issues.map((issue) => issue.code)).toEqual(['prose_success_signal_on_non_done_run'])
  })

  it('does not flag success prose inside unrelated tokens', () => {
    const integrity = evaluateRunExecutionIntegrity(run({ stage: 'implement' }), [
      evidence({ type: 'custom', payload: { note: 'PASSWORD reset; PASS-token regenerated' } }),
    ])

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.issues).toEqual([])
  })

  it('does not flag state-reconcile audit prose or success text that is not a final verdict', () => {
    const integrity = evaluateRunExecutionIntegrity(run({ stage: 'implement' }), [
      evidence({ type: 'custom', payload: { kind: 'state-reconcile', message: 'PASS appeared in merge title' } }),
      evidence({ type: 'custom', payload: { kind: 'operator-note', note: 'job completed successfully on retry, then re-ran' } }),
      evidence({ type: 'custom', payload: { kind: 'operator-note', note: 'PASS, then FAIL during the rerun' } }),
    ])

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.issues).toEqual([])
  })

  it('treats explicit external outcomes as external instead of orchestrated', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'done' }),
      [evidence({ payload: { kind: 'external-outcome', outcome: 'done', reason: 'verified by operator' } })],
    )

    expect(integrity.mode).toBe('external')
    expect(integrity.externalOutcome).toBe('done')
    expect(integrity.issues).toEqual([])
  })

  it('treats bulk-import evidence as recorded instead of inconsistent', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'done', sessionId: null, worktreePaths: null, commitSha: 'abc123' }),
      [evidence({ payload: { kind: 'bulk-import-shipped-spec', sourcePath: 'specs/current/workflow-profile-runtime', importedAt: '2026-05-01T00:00:00.000Z' } })],
    )

    expect(integrity.mode).toBe('recorded')
    expect(integrity.hasDuctumLineage).toBe(false)
    expect(integrity.hasExternalOutcome).toBe(false)
    expect(integrity.issues).toEqual([])
  })

  it('flags external outcomes on failed or active runs instead of rebranding them external', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'implement', terminalState: 'failed', commitSha: null }),
      [evidence({ payload: { kind: 'external-outcome', outcome: 'fixed', reason: 'done outside Ductum' } })],
    )

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.hasDuctumLineage).toBe(false)
    expect(integrity.externalOutcome).toBe('fixed')
    expect(integrity.issues.map((issue) => issue.code)).toEqual(['external_outcome_on_non_done_run'])
  })

  it('does not treat invalid outcome strings as explicit outcomes', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'done', sessionId: null, worktreePaths: null, commitSha: null }),
      [evidence({ payload: { kind: 'external-outcome', outcome: 'tbd', reason: 'not explicit' } })],
    )

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.hasExternalOutcome).toBe(false)
    expect(integrity.externalOutcome).toBe(null)
    expect(integrity.issues.map((issue) => issue.code)).toEqual([
      'invalid_external_outcome',
      'done_run_without_lineage_or_external_outcome',
    ])
  })

  it('keeps failed non-lineage runs recorded instead of unknown', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'implement', terminalState: 'failed', sessionId: null, worktreePaths: null, commitSha: null }),
      [],
    )

    expect(integrity.mode).toBe('recorded')
    expect(integrity.issues).toEqual([])
  })

  it('does not duplicate linked-commit warnings for already inconsistent done runs', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'done', sessionId: null, worktreePaths: null, commitSha: 'abc123' }),
      [],
    )

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.issues.map((issue) => issue.code)).toEqual([
      'done_run_without_lineage_or_external_outcome',
    ])
  })

  it('flags done tasks and bakeoff candidates without lineage or explicit outcomes', () => {
    const task = baseTask({ status: 'done', name: 'candidate-codex', strategyRole: 'candidate', strategyGroup: 'bon-1' })
    const integrity = evaluateTaskExecutionIntegrity(
      task,
      { strategy: 'best_of_n' } as Spec,
      [run({ sessionId: null, worktreePaths: null, commitSha: null, stage: 'done' })],
      new Map(),
    )

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'done_task_without_lineage_or_external_outcome',
      'bakeoff_candidate_without_outcome',
    ]))
  })
})

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1' as Run['id'],
    taskId: 'task-1' as Run['taskId'],
    agentId: 'agent-1' as Run['agentId'],
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
    branch: 'feat/demo',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/worktree'],
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Task['id'],
    specId: 'spec-1' as Task['specId'],
    targetId: null,
    name: 'P1',
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'active',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'evidence-1' as Evidence['id'],
    runId: 'run-1' as Evidence['runId'],
    type: 'custom',
    payload: {},
    createdAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}
