import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncGitHubShipArtifacts } from '../lib/github-lifecycle.js'
import { createFixture, type TestFixture } from './helpers.js'
import { setupGitHubIssueFixture } from './github-lifecycle-issue-comment.helpers.js'
import { registerRouteTestCleanup } from './routes/shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('GitHub lifecycle issue comment sync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('comments back on imported issues using GitHub App auth', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupGitHubIssueFixture(fixture)
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'verify', passed: true },
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.includes('/pulls?state=open')) return new Response(JSON.stringify([]), { status: 200 })
      if (url.endsWith('/pulls')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
        return new Response(JSON.stringify({
          number: 81,
          html_url: 'https://github.com/edictum-ai/ductum/pull/81',
          title: 'feat: core: imported issue',
          head: { ref: 'feat/github-issue-intake-auth' },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12/comments')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
        const body = JSON.parse(String(init?.body)) as { body: string }
        expect(body.body).toContain('<!-- ductum:github-issue-sync:')
        expect(body.body).toContain('PR: #81 https://github.com/edictum-ai/ductum/pull/81')
        return new Response(JSON.stringify({
          id: 101,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-101',
          body: body.body,
          user: { login: 'ductum-factory', type: 'Bot' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const gitCalls: string[][] = []
    const result = await syncGitHubShipArtifacts({
      repos: fixture.repos,
      factoryDataDir: factoryDir,
      now: () => new Date('2026-06-23T12:00:00.000Z'),
      runGit: async (args) => {
        gitCalls.push(args)
        return { stdout: args.includes('rev-parse') ? 'abc123\n' : '' }
      },
    }, run.id)

    expect(result).toMatchObject({
      skipped: false,
      branch: 'feat/github-issue-intake-auth',
      commitSha: 'abc123',
      prNumber: 81,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
    })
    expect(gitCalls).toEqual(expect.arrayContaining([
      ['-C', '/tmp/worktree', 'checkout', '-B', `ductum/github-lifecycle-${run.id.slice(0, 8)}`],
      [
        '-c',
        expect.stringContaining('AUTHORIZATION: basic'),
        'ls-remote',
        '--heads',
        'https://github.com/edictum-ai/ductum.git',
        'refs/heads/feat/github-issue-intake-auth',
      ],
      ['-C', '/tmp/worktree', 'rev-parse', 'HEAD'],
    ]))
    expect(fixture.repos.evidence.list(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-branch-sync', actorType: 'github_app' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-pr-sync', actorType: 'github_app', prNumber: 81 }) }),
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'github-issue-comment-sync',
          actorType: 'github_app',
          issueNumber: 12,
          commentUrl: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-101',
        }),
      }),
    ]))
  })

  it('updates an existing issue sync comment to include CI evidence', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupGitHubIssueFixture(fixture, {
      run: {
        branch: 'feat/github-issue-intake-auth',
        commitSha: 'abc123',
        prNumber: 81,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
        ciStatus: 'pass',
      },
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'verify', command: 'pnpm test', passed: true },
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'ci',
      payload: {
        passed: true,
        commitSha: 'abc123',
        checks: [{ name: 'build-and-test', status: 'completed', conclusion: 'success' }],
      },
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'github-issue-comment-sync',
        issueNumber: 12,
        issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
        commentUrl: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-101',
      },
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/pulls/81')) {
        return new Response(JSON.stringify({
          number: 81,
          html_url: 'https://github.com/edictum-ai/ductum/pull/81',
          title: 'feat: core: imported issue',
          head: { ref: 'feat/github-issue-intake-auth' },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      if (url.endsWith('/issues/comments/101')) {
        expect(init?.method).toBe('PATCH')
        const body = JSON.parse(String(init?.body)) as { body: string }
        expect(body.body).toContain('- Verification: pnpm test (passed)')
        expect(body.body).toContain('- CI: commit `abc123` (passed: build-and-test)')
        return new Response(JSON.stringify({
          id: 101,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-101',
          body: body.body,
          user: { login: 'ductum-factory', type: 'Bot' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await syncGitHubShipArtifacts({
      repos: fixture.repos,
      factoryDataDir: factoryDir,
      now: () => new Date('2026-06-23T12:00:00.000Z'),
      runGit: async (args) => ({ stdout: args.includes('rev-parse') ? 'abc123\n' : '' }),
    }, run.id)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/issues/comments/101'),
      expect.objectContaining({ method: 'PATCH' }),
    )
  })
})
