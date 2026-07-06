import { createFixture, createId, describe, execFileAsync, expect, it, join, mkdtemp, registerRouteTestCleanup, requestJson, rm, seedBase, setupMergeFixture, tmpdir, type Run, type TestFixture } from './shared.js'
import { buildRuntimeReviewEvidencePayload, buildRuntimeVerificationEvidencePayload } from '../../lib/runtime-approval-evidence.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - unattended remote CI push', () => {
  it('allows unattended push when workflow requires green remote CI and CI evidence is strictly green', async () => {
    const mergeFix = await setupMergeFixture()
    const remoteRoot = await mkdtemp(join(tmpdir(), 'ductum-remote-ci-'))
    const remote = join(remoteRoot, 'origin.git')
    try {
      await execFileAsync('git', ['init', '--bare', '-b', 'main', remote])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'remote', 'add', 'origin', remote])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'push', 'origin', 'main'])
      const head = (await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])).stdout.toString().trim()

      fixture = await createFixture({
        operatorToken: 'operator-secret',
        merge: { push: true, base: 'main', strategy: 'merge' },
        costBudget: { perRunHardUsd: 10 },
      })
      const { task, builder } = seedBase(fixture)
      const run = makeRun(task.id, builder.id, mergeFix.worktree, head)
      fixture.repos.runs.create(run)
      addPassingEvidence(run.id, head)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
        headers: { 'x-ductum-operator-token': 'operator-secret' },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done', pushed: true })
      const remoteLog = await execFileAsync('git', ['-C', remote, 'log', '--oneline', 'main'])
      expect(remoteLog.stdout).toMatch(/chore\(merge\): integrate approved branch changes/)
    } finally {
      await rm(remoteRoot, { recursive: true, force: true }).catch(() => undefined)
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('blocks unattended push when remote CI is skipped, neutral, or empty', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const head = (await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])).stdout.toString().trim()

      for (const checks of [
        [{ name: 'unit', status: 'completed', conclusion: 'skipped' }],
        [{ name: 'unit', status: 'completed', conclusion: 'neutral' }],
        [],
      ] as const) {
        fixture = await createFixture({
          operatorToken: 'operator-secret',
          merge: { push: true, base: 'main', strategy: 'merge' },
          costBudget: { perRunHardUsd: 10 },
        })
        const { task, builder } = seedBase(fixture)
        const run = makeRun(task.id, builder.id, mergeFix.worktree, head)
        fixture.repos.runs.create(run)
        addPassingEvidence(run.id, head, checks)

        const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
          method: 'POST',
          body: { unattended: true },
          headers: { 'x-ductum-operator-token': 'operator-secret' },
        })

        expect(result.response.status).toBe(200)
        expect(result.json).toMatchObject({
          success: false,
          reason: expect.stringContaining('remote CI is not green'),
        })
      }
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

function addPassingEvidence(
  runId: Run['id'],
  commitSha: string,
  checks: readonly Record<string, unknown>[] = [{ name: 'unit', status: 'completed', conclusion: 'success' }],
) {
  fixture!.repos.evidence.create({ id: createId<'EvidenceId'>(), runId, type: 'custom', payload: buildRuntimeVerificationEvidencePayload({ commitSha } as Pick<Run, 'commitSha'>, { passed: true, output: 'ok' }) })
  fixture!.repos.evidence.create({ id: createId<'EvidenceId'>(), runId, type: 'custom', payload: buildRuntimeReviewEvidencePayload({ verdict: 'pass', passed: true, feedback: 'PASS' }, commitSha) })
  fixture!.repos.evidence.create({ id: createId<'EvidenceId'>(), runId, type: 'ci', payload: { passed: true, commitSha, ductumEvidenceProducer: 'ductum.watcher', checks } })
}

function makeRun(taskId: Run['taskId'], agentId: Run['agentId'], worktreePath: string, commitSha: string): Run {
  return {
    id: createId<'RunId'>(), taskId, agentId, parentRunId: null, stage: 'ship', terminalState: null,
    resetCount: 0, completedStages: ['understand', 'implement'], blockedReason: null, pendingApproval: true,
    sessionId: null, branch: 'feature/x', commitSha, prNumber: null, prUrl: null, worktreePaths: [worktreePath],
    runtimeModel: null, runtimeHarness: null, runtimeSandboxProfile: null, runtimeWorkflowProfile: {
      id: createId<'ConfigResourceId'>(), name: 'remote-ci', projectId: null, path: 'workflow.yaml',
      unattended: { autoApprove: true, autoMerge: true, autoPush: true, pushRequires: 'remote_ci' },
    },
    ciStatus: null, reviewStatus: null, failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0,
    costUsd: 0, lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120, verifyRetries: 0,
    completionSummary: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}
