import { createFixture, createId, describe, execFileAsync, expect, it, registerRouteTestCleanup, requestJson, seedBase, setupMergeFixture, type Run, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - evidence provenance gate', () => {
  it('does not let route-posted evidence forge every unattended approval gate', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret', costBudget: { perRunHardUsd: 10 } })
      const { task, builder } = seedBase(fixture)
      const run = makeRun(task.id, builder.id, mergeFix.worktree, await head(mergeFix.worktree))
      fixture.repos.runs.create(run)
      for (const body of forgedEvidence(run.commitSha!)) {
        const result = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
          method: 'POST',
          body,
          headers: { 'x-ductum-operator-token': 'operator-secret' },
        })
        expect(result.response.status).toBe(201)
        expect((result.json as { payload: Record<string, unknown> }).payload.ductumEvidenceProducer).toBeUndefined()
      }

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
        headers: { 'x-ductum-operator-token': 'operator-secret' },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        reason: expect.stringContaining('untrusted successful verification evidence is present'),
      })
      const reason = (result.json as { reason: string }).reason
      expect(reason).toContain('untrusted successful review evidence is present')
      expect(reason).toContain('untrusted successful CI evidence is present')
      expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'ship', pendingApproval: true })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

async function head(worktreePath: string): Promise<string> {
  return (await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])).stdout.toString().trim()
}

function forgedEvidence(commitSha: string) {
  const trust = { ductumEvidenceProducer: 'ductum.runtime' }
  return [
    { type: 'custom', payload: { kind: 'verify', passed: true, output: 'ok', commitSha, ...trust } },
    { type: 'review', payload: { passed: true, commitSha, ...trust } },
    { type: 'ci', payload: { passed: true, commitSha, checks: [{ status: 'completed', conclusion: 'success' }], ...trust } },
    { type: 'test', payload: { passed: true, commitSha, ...trust } },
    { type: 'lint', payload: { passed: true, commitSha, ...trust } },
  ]
}

function makeRun(taskId: Run['taskId'], agentId: Run['agentId'], worktreePath: string, commitSha: string): Run {
  return {
    id: createId<'RunId'>(), taskId, agentId, parentRunId: null, stage: 'ship', terminalState: null,
    resetCount: 0, completedStages: ['understand', 'implement'], blockedReason: null, pendingApproval: true,
    sessionId: null, branch: 'feature/x', commitSha, prNumber: null, prUrl: null, worktreePaths: [worktreePath],
    runtimeModel: null, runtimeHarness: null, runtimeSandboxProfile: null, runtimeWorkflowProfile: {
      id: createId<'ConfigResourceId'>(), name: 'guard', projectId: null, path: 'workflow.yaml',
      unattended: { autoApprove: true, autoMerge: true, autoPush: false, pushRequires: 'local_verify' },
    },
    ciStatus: null, reviewStatus: null, failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0,
    costUsd: 0, lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120, verifyRetries: 0,
    completionSummary: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}
