import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { syncGitHubShipArtifacts } from '../../lib/github-lifecycle.js'
import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  mergeApprovedRun,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupMergeFixture,
  vi,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

async function resetFeatureBranchToBase(upstream: string, worktree: string): Promise<void> {
  // upstream must be on main for the assertBranchContainsBase check later.
  await execFileAsync('git', ['-C', upstream, 'checkout', 'main'])
  // feature/x is checked out in the worktree — `git reset --hard main` from the
  // worktree resets feature/x back to main, dropping prior feature commits.
  await execFileAsync('git', ['-C', worktree, 'reset', '--hard', 'main'])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.name', 'Test'])
}

function createRunForSync(fixture: TestFixture, builderId: string, taskId: string) {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: taskId as never,
    agentId: builderId as never,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/worktree'],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })
}

function createRunForMerge(fixture: TestFixture, builderId: string, taskId: string, worktreePath: string) {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: taskId as never,
    agentId: builderId as never,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: true,
    sessionId: null,
    branch: 'feature/x',
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: [worktreePath],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })
}

describe('API routes - non-empty tree-diff gate (issue #292)', () => {
  it('blocks GitHub ship sync before opening a PR when HEAD has commits but the final tree matches base', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', defaultBranch: 'main' },
    })
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'empty commit ship',
      status: 'approved',
      document: '# imported',
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      targetId: null,
      componentId: null,
      name: 'Empty commit',
      prompt: 'implement',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: [],
    })
    const run = createRunForSync(fixture, builder.id, task.id)

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const gitCalls: string[][] = []

    await expect(syncGitHubShipArtifacts({
      repos: {
        runs: fixture.repos.runs,
        tasks: fixture.repos.tasks,
        specs: fixture.repos.specs,
        repositories: fixture.repos.repositories,
        secrets: fixture.repos.secrets,
        evidence: fixture.repos.evidence,
      },
      runGit: async (args) => {
        gitCalls.push(args)
        if (args.includes('rev-parse')) return { stdout: 'abc123\n' }
        if (args.includes('rev-list')) return { stdout: '1\n' }
        if (args.includes('diff')) return { stdout: args[args.length - 1] === 'main..HEAD' ? '' : ' 1 file changed\n' }
        return { stdout: '' }
      },
      now: () => new Date('2026-07-05T12:00:00.000Z'),
    }, run.id)).rejects.toThrow(/net tree diff is empty/)

    expect(gitCalls).toContainEqual(['-C', '/tmp/worktree', 'rev-list', '--count', 'main..HEAD'])
    expect(gitCalls).toContainEqual(['-C', '/tmp/worktree', 'diff', '--shortstat', 'main..HEAD'])
    expect(gitCalls.some((args) => args.includes('push'))).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks local merge when the branch has commits but the net tree diff is empty (empty commit only, real git)', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      await resetFeatureBranchToBase(mergeFix.upstream, mergeFix.worktree)
      await execFileAsync('git', ['-C', mergeFix.worktree, 'commit', '--allow-empty', '-m', 'empty commit only'])

      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = createRunForMerge(fixture, builder.id, task.id, mergeFix.worktree)

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(/net tree diff is empty/)
      expect(fixture.repos.runs.get(run.id)?.stage).toBe('ship')

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).not.toMatch(/empty commit only/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('blocks local merge when the branch follows a change-plus-revert pattern leaving an empty tree diff (real git)', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      await resetFeatureBranchToBase(mergeFix.upstream, mergeFix.worktree)
      await writeFile(join(mergeFix.worktree, 'throwaway.txt'), 'temporary\n')
      await execFileAsync('git', ['-C', mergeFix.worktree, 'add', 'throwaway.txt'])
      await execFileAsync('git', ['-C', mergeFix.worktree, 'commit', '-m', 'add throwaway'])
      await execFileAsync('git', ['-C', mergeFix.worktree, 'rm', 'throwaway.txt'])
      await execFileAsync('git', ['-C', mergeFix.worktree, 'commit', '-m', 'revert throwaway'])

      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = createRunForMerge(fixture, builder.id, task.id, mergeFix.worktree)

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(/net tree diff is empty/)
      expect(fixture.repos.runs.get(run.id)?.stage).toBe('ship')

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).not.toMatch(/add throwaway/)
      expect(log.stdout).not.toMatch(/revert throwaway/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('routes zero-diff no-op approval into a failed terminal state distinguishable from shipped work', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'feature/noop',
      commitSha: 'abc1234',
      prNumber: null,
      prUrl: null,
      // Missing worktree path triggers the missing-worktree branch in mergeApprovedRun.
      worktreePaths: ['/tmp/ductum-missing-noop-worktree-zero-diff'],
      ciStatus: null,
      reviewStatus: 'pass',
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'worktree.snapshot',
        branch: 'feature/noop',
        commitSha: 'abc1234',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' },
        timestamp: '2026-07-05T10:00:00.000Z',
      },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({ success: false })
    // Stage is NOT 'done' — distinguishable from shipped work at the state level.
    expect(String((result.json as Record<string, unknown>).reason ?? '')).toContain('zero-diff snapshot')

    const finalRun = fixture.repos.runs.get(run.id)
    expect(finalRun?.stage).not.toBe('done')
    expect(finalRun?.terminalState).toBe('failed')
    expect(finalRun?.failReason).toContain('zero-diff snapshot')
  }, 60_000)
})
