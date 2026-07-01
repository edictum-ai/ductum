/**
 * Issue #225 regression: a PR-backed approval must keep run.commitSha pinned
 * to the current PR head even when the preserved factory worktree is checked
 * out at an older local commit.
 *
 * Live failure (PR #224, 2026-07-01): `ductum approve pc6mDqj5tffq` failed
 * stale because `mergeApprovedRun` synced git artifacts from
 * `run.worktreePaths[0]` (commit 34625f58) and overwrote the recorded current
 * PR head (27925b29) before the PR stale guard ran. The guard then compared
 * current main against the stale commit and failed.
 *
 * This test pins the fix: with the recorded head current and the worktree
 * stale, approval merges the current PR head through the GitHub App REST
 * endpoint — the merge body carries the recorded PR head SHA, never the stale
 * worktree commit. Under the old behavior the stale guard threw before the
 * merge endpoint was ever reached.
 */
import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  join,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupFakeGh,
  setupMergeFixture,
  vi,
  writeFile,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth, buildGreenCheckRunsResponse } from './github-app-merge-shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - PR merge stale preserved worktree (issue #225)', () => {
  it('merges the recorded current PR head when the preserved worktree is stale', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    try {
      // The preserved worktree is left at `staleCommit` (feature/x with only
      // feature.txt); it will NOT contain the parallel advance on main below.
      const { stdout: staleOut } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const staleCommit = staleOut.trim()

      // Advance main in parallel so staleCommit no longer contains main.
      await writeFile(join(mergeFix.upstream, 'base.txt'), 'current base\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'base.txt'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'current base'])

      // Build the recorded current PR head as a commit that DOES contain main.
      await execFileAsync('git', ['-C', mergeFix.upstream, 'checkout', '-b', 'feature/pr-current', 'main'])
      await writeFile(join(mergeFix.upstream, 'pr-change.txt'), 'pr change\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'pr-change.txt'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'pr change'])
      const { stdout: prHeadOut } = await execFileAsync('git', ['-C', mergeFix.upstream, 'rev-parse', 'HEAD'])
      const currentPrHead = prHeadOut.trim()
      await execFileAsync('git', ['-C', mergeFix.upstream, 'checkout', 'main'])

      // GitHub App pull pulls `origin main` (non-fatal on failure); point
      // origin at the upstream itself so the post-merge pull resolves.
      await execFileAsync('git', ['-C', mergeFix.upstream, 'remote', 'add', 'origin', mergeFix.upstream])

      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const updatedRepository = fixture.repos.repositories.update(repository.id, {
        spec: { ...repository.spec, localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: updatedRepository.id,
        targetId: null,
        componentId: null,
        name: 'Stale worktree PR merge',
        prompt: 'implement',
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: ['pnpm test'],
      })
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
        branch: 'feature/pr-current',
        commitSha: currentPrHead,
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        // Preserved worktree is still checked out at the stale local commit.
        worktreePaths: [mergeFix.worktree],
        ciStatus: 'pass',
        reviewStatus: 'pass',
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Stale worktree PR merge',
            head: { ref: 'feature/pr-current' },
            base: { ref: 'main' },
          }), { status: 200 })
        }
        const green = buildGreenCheckRunsResponse(currentPrHead)
        if (url.endsWith(green.checkRunsUrl)) {
          return new Response(green.checkRunsBody, { status: 200 })
        }
        if (url.endsWith(green.statusesUrl)) {
          return new Response(green.statusesBody, { status: 200 })
        }
        if (url.endsWith(green.branchProtectionUrl)) {
          return new Response('Branch not protected', { status: 404 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          const body = JSON.parse(String(init?.body)) as { sha?: string }
          // The pinned expected head must be the recorded current PR head,
          // NOT the stale worktree commit. Under the old behavior this guard
          // threw before the merge endpoint was ever reached.
          expect(body.sha).toBe(currentPrHead)
          expect(body.sha).not.toBe(staleCommit)
          return new Response(JSON.stringify({ sha: 'def456merge', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      // The GitHub App REST merge endpoint was actually called.
      expect(fetchMock.mock.calls.map(([url]) => String(url)))
        .toContain('https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge')
      // The recorded head was never clobbered with the stale worktree commit.
      const after = fixture.repos.runs.get(run.id)
      expect(after?.commitSha).not.toBe(staleCommit)
      expect(fixture.repos.evidence.list(run.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'github-pr-merge', prNumber: 42 }),
        }),
      ]))
      // Local gh dev path was never used (production writes stay on GitHub App).
      expect(await fakeGh.readLog()).toBe('')
    } finally {
      vi.restoreAllMocks()
      fixture?.close()
      fixture = undefined
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)
})
