import { PostCompletionRouter, type CodeReviewResult, type Run } from '@ductum/core'
import { buildRuntimeReviewEvidencePayload, buildRuntimeVerificationEvidencePayload } from '../../lib/runtime-approval-evidence.js'
import { createFixture, createId, describe, execFileAsync, expect, it, registerRouteTestCleanup, requestJson, seedBase, setupMergeFixture, writeFile, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - unattended review freshness races', () => {
  it('does not enrich generic internal-review PASS evidence with the current run commit', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const head = await worktreeHead(mergeFix.worktree)
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = makeRun(task.id, builder.id, mergeFix.worktree, {
        runtimeWorkflowProfile: policy(),
        commitSha: head,
      })
      fixture.repos.runs.create(run)

      const review = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
        method: 'POST',
        body: { type: 'custom', payload: { kind: 'internal-review', verdict: 'pass', passed: true } },
      })
      const verify = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
        method: 'POST',
        body: { type: 'custom', payload: { kind: 'verify', passed: true, output: 'ok' } },
      })

      expect(review.response.status).toBe(201)
      expect(verify.response.status).toBe(201)
      expect(review.json).toMatchObject({
        payload: { kind: 'internal-review', verdict: 'pass', passed: true },
      })
      expect((review.json as { payload: Record<string, unknown> }).payload.commitSha).toBeUndefined()
      expect(verify.json).toMatchObject({
        payload: { kind: 'verify', passed: true, output: 'ok', commitSha: head },
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        reason: expect.stringContaining('valid review/judge result has not passed'),
      })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('does not satisfy unattended approval when a review PASS lacks a reviewed commit marker', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const oldHead = await worktreeHead(mergeFix.worktree)
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const root = makeRun(task.id, builder.id, mergeFix.worktree, { runtimeWorkflowProfile: policy(), stage: 'done', pendingApproval: false, commitSha: oldHead })
      fixture.repos.runs.create(root)
      const fixTask = fixture.repos.tasks.create({ ...task, id: createId<'TaskId'>(), name: `fix-${task.name}-r1`, requiredRole: 'builder', status: 'active' })
      const fixRun = makeRun(fixTask.id, builder.id, mergeFix.worktree, { parentRunId: root.id, stage: 'implement', pendingApproval: false, commitSha: oldHead })
      fixture.repos.runs.create(fixRun)
      const router = routerFor(builder.id)
      await router.runFixCompletion(fixRun)
      const reviewTask = fixture.repos.tasks.list(task.specId).find((item) => item.name === `review-${task.name}-r2`)!
      fixture.repos.tasks.updatePrompt(reviewTask.id, reviewTask.prompt.replace(/^Reviewed Commit:\s*[0-9a-f]{7,64}\s*$/im, 'Reviewed Commit: unknown'))
      await writeFile(`${mergeFix.worktree}/after-marker-loss.txt`, 'new head\n')
      await execFileAsync('git', ['-C', mergeFix.worktree, 'add', 'after-marker-loss.txt'])
      await execFileAsync('git', ['-C', mergeFix.worktree, 'commit', '-m', 'advance after marker loss'])
      const newHead = await worktreeHead(mergeFix.worktree)
      const reviewRun = makeRun(reviewTask.id, builder.id, null, { parentRunId: fixRun.id, stage: 'implement', commitSha: null })
      fixture.repos.runs.create(reviewRun)
      await router.runReviewCompletion(reviewRun)
      fixture.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: root.id, type: 'custom', payload: { kind: 'verify', passed: true, commitSha: newHead } })

      const rootEvidence = fixture.repos.evidence.list(root.id).map((item) => item.payload)
      expect(rootEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'internal-review', verdict: 'pass' })]))
      expect(rootEvidence).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'internal-review', verdict: 'pass', commitSha: newHead })]))
      const result = await requestJson(fixture.app, `/api/runs/${root.id}/approve`, { method: 'POST', body: { unattended: true } })
      expect(result.json).toMatchObject({ success: false, reason: expect.stringContaining('valid review/judge result has not passed') })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('does not stamp a review PASS for an old dispatched diff onto a newer root HEAD', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const oldHead = await worktreeHead(mergeFix.worktree)
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const root = makeRun(task.id, builder.id, mergeFix.worktree, { runtimeWorkflowProfile: policy(), stage: 'done', pendingApproval: false, commitSha: oldHead })
      fixture.repos.runs.create(root)
      const fixTask = fixture.repos.tasks.create({ ...task, id: createId<'TaskId'>(), name: `fix-${task.name}-r1`, requiredRole: 'builder', status: 'active' })
      const fixRun = makeRun(fixTask.id, builder.id, mergeFix.worktree, { parentRunId: root.id, stage: 'implement', pendingApproval: false, commitSha: oldHead })
      fixture.repos.runs.create(fixRun)
      const router = routerFor(builder.id)
      await router.runFixCompletion(fixRun)
      await writeFile(`${mergeFix.worktree}/after-dispatch.txt`, 'new head\n')
      await execFileAsync('git', ['-C', mergeFix.worktree, 'add', 'after-dispatch.txt'])
      await execFileAsync('git', ['-C', mergeFix.worktree, 'commit', '-m', 'after review dispatch'])
      const newHead = await worktreeHead(mergeFix.worktree)
      const reviewTask = fixture.repos.tasks.list(task.specId).find((item) => item.name === `review-${task.name}-r2`)!
      const reviewRun = makeRun(reviewTask.id, builder.id, null, { parentRunId: fixRun.id, stage: 'implement', commitSha: null })
      fixture.repos.runs.create(reviewRun)
      await router.runReviewCompletion(reviewRun)
      fixture.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: root.id, type: 'custom', payload: { kind: 'verify', passed: true, commitSha: newHead } })

      const rootEvidence = fixture.repos.evidence.list(root.id).map((item) => item.payload)
      expect(rootEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'internal-review', verdict: 'pass', commitSha: oldHead })]))
      expect(rootEvidence).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'internal-review', verdict: 'pass', commitSha: newHead })]))
      const result = await requestJson(fixture.app, `/api/runs/${root.id}/approve`, { method: 'POST', body: { unattended: true } })
      expect(result.json).toMatchObject({ success: false, reason: expect.stringContaining('valid review/judge result has not passed') })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

const worktreeHead = async (worktreePath: string): Promise<string> =>
  (await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])).stdout.toString().trim()

function routerFor(agentId: Run['agentId']): PostCompletionRouter {
  return new PostCompletionRouter({
    runRepo: fixture!.repos.runs, taskRepo: fixture!.repos.tasks, specRepo: fixture!.repos.specs, projectRepo: fixture!.repos.projects,
    evidenceRepo: fixture!.repos.evidence, stateMachine: fixture!.context.stateMachine, eventEmitter: fixture!.context.events,
    postCompletion: { resolveVerifyCommands: () => ['true'], resolveReviewerAgent: () => agentId,
      resolveRunCompletionText: () => '{"kind":"ductum-review-result","verdict":"pass","summary":"PASS","findings":[]}',
      onReadyToShip: (id: Run['id']) => { fixture!.repos.runs.updateStage(id, 'ship'); fixture!.repos.runs.updateWorkflowState(id, { pendingApproval: true }) },
      onVerificationResult: (id, result) => { fixture!.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: id, type: 'custom',
        payload: buildRuntimeVerificationEvidencePayload(fixture!.repos.runs.get(id), result) }) },
      onReviewResult: (id: Run['id'], result: CodeReviewResult, commitSha?: string) => { fixture!.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: id, type: 'custom',
        payload: buildRuntimeReviewEvidencePayload(fixture!.repos.runs.get(id), result, commitSha) }) } },
  })
}

const policy = (): NonNullable<Run['runtimeWorkflowProfile']> => ({
  id: createId<'ConfigResourceId'>(), name: 'guard', projectId: null, path: 'workflow.yaml',
  unattended: { autoApprove: true, autoMerge: true, autoPush: false, pushRequires: 'local_verify' },
})

function makeRun(taskId: Run['taskId'], agentId: Run['agentId'], worktreePath: string | null, overrides: Partial<Run> = {}): Run {
  return {
    id: createId<'RunId'>(), taskId, agentId, parentRunId: null, stage: 'ship', terminalState: null, resetCount: 0,
    completedStages: ['understand', 'implement'], blockedReason: null, pendingApproval: true, sessionId: null,
    branch: 'feature/x', commitSha: 'abc123', prNumber: null, prUrl: null, worktreePaths: worktreePath == null ? null : [worktreePath],
    runtimeModel: null, runtimeHarness: null, runtimeSandboxProfile: null, runtimeWorkflowProfile: null, ciStatus: null,
    reviewStatus: null, failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
    lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120, verifyRetries: 0, completionSummary: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
  }
}
