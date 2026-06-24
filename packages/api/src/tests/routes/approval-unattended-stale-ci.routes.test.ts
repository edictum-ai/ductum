import { createFixture, createId, describe, execFileAsync, expect, it, registerRouteTestCleanup, requestJson, seedBase, setupMergeFixture, type Run, type TestFixture } from './shared.js'
import { buildRuntimeReviewEvidencePayload, buildRuntimeVerificationEvidencePayload } from '../../lib/runtime-approval-evidence.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - unattended approvals stale CI recovery', () => {
  it('does not trust stale ciStatus pass when stalled approval lacks current strict remote CI evidence', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret', costBudget: { perRunHardUsd: 10 } })
      const { task, builder, project } = seedBase(fixture)
      fixture.repos.projects.update(project.id, {
        config: { ...project.config, externalReviewRequired: true },
      })
      const currentHead = (await execFileAsync(
        'git',
        ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'],
        { encoding: 'utf-8' },
      )).stdout.trim()
      const run = makeRun(task.id, builder.id, mergeFix.worktree, {
        runtimeWorkflowProfile: policy({ autoPush: true, pushRequires: 'remote_ci' }),
        terminalState: 'stalled',
        failReason: 'stale_slot_gc',
        recoverable: true,
        commitSha: currentHead,
        ciStatus: 'pass',
        reviewStatus: 'pass',
      })
      fixture.repos.runs.create(run)
      addPassingEvidence(run.id, currentHead)
      fixture.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: run.id,
        type: 'ci',
        payload: {
          passed: true,
          commitSha: 'old-head',
          ductumEvidenceProducer: 'ductum.watcher',
          checks: [{ name: 'unit', status: 'completed', conclusion: 'success' }],
        },
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
        headers: { 'x-ductum-operator-token': 'operator-secret' },
      })

      expect(result.response.status).toBe(400)
      expect(result.text).toContain('retry the run before approval')
      expect(fixture.repos.runs.get(run.id)).toMatchObject({ terminalState: 'stalled', pendingApproval: true })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

const policy = (overrides: Partial<NonNullable<Run['runtimeWorkflowProfile']>['unattended']> = {}) => ({
  id: createId<'ConfigResourceId'>(),
  name: 'guard',
  projectId: null,
  path: 'workflow.yaml',
  unattended: { autoApprove: true, autoMerge: true, autoPush: false, pushRequires: 'local_verify' as const, ...overrides },
})

function makeRun(
  taskId: Run['taskId'],
  agentId: Run['agentId'],
  worktreePath: string | null,
  overrides: Partial<Run> = {},
): Run {
  return {
    id: createId<'RunId'>(),
    taskId, agentId,
    parentRunId: null,
    stage: 'ship', terminalState: null, resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null, pendingApproval: true, sessionId: null,
    branch: 'feature/x', commitSha: 'abc123', prNumber: null, prUrl: null,
    worktreePaths: worktreePath == null ? null : [worktreePath],
    runtimeModel: null, runtimeHarness: null, runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null, reviewStatus: null, failReason: null, recoverable: true,
    tokensIn: 0, tokensOut: 0, costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120, verifyRetries: 0, completionSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function addPassingEvidence(runId: Run['id'], commitSha = 'abc123') {
  const run = { commitSha } as Pick<Run, 'commitSha'>
  fixture!.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: buildRuntimeVerificationEvidencePayload(run, { passed: true, output: 'ok' }),
  })
  fixture!.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: buildRuntimeReviewEvidencePayload({ verdict: 'pass', passed: true, feedback: 'PASS' }, commitSha),
  })
}
