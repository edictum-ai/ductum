import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveGitHubWriteAuth } from '../lib/github-auth.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'
import { execFileAsync, registerRouteTestCleanup, setupMergeFixture } from './routes/shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })
describe('GitHub lifecycle auth and provenance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('fails closed on production write auth when no GitHub App auth is configured', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })

    await expect(resolveGitHubWriteAuth({
      factoryDir: mkdtempSync(join(tmpdir(), 'ductum-gh-auth-')),
      repository,
      secrets: fixture.repos.secrets,
      env: {},
    })).rejects.toThrow(/missing GitHub App installation auth/i)
  })
  it('uses PAT auth only when dev mode is explicitly named', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })

    const auth = await resolveGitHubWriteAuth({
      factoryDir: mkdtempSync(join(tmpdir(), 'ductum-gh-dev-')),
      repository,
      secrets: fixture.repos.secrets,
      env: {
        DUCTUM_GITHUB_DEV_WRITE_MODE: 'pat',
        DUCTUM_GITHUB_DEV_TOKEN: 'dev-token',
      },
    })

    expect(auth.actor).toEqual({ type: 'dev_pat', label: 'dev PAT' })
    expect(auth.token).toBe('dev-token')
  })
  it('records operator approval separately from GitHub actor provenance', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
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
        branch: 'feature/x',
        commitSha: head.toString().trim(),
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        worktreePaths: [mergeFix.worktree],
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
      fixture.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: run.id,
        type: 'custom',
        payload: {
          kind: 'github-pr-sync',
          actorType: 'github_app',
          actorLabel: 'GitHub App 123 installation 456',
          prNumber: 42,
          prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        },
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      const evidence = fixture.repos.evidence.list(run.id)
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-pr-sync', actorType: 'github_app' }) }),
        expect.objectContaining({ payload: expect.objectContaining({ kind: 'operator-approval', actorType: 'operator' }) }),
      ]))
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
