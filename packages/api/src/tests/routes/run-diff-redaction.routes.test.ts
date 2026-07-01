import { createId } from '@ductum/core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

let fixture: TestFixture | undefined
const cleanupDirs: string[] = []

afterEach(async () => {
  fixture?.close()
  fixture = undefined
  await Promise.all(cleanupDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('API routes - run diff redaction', () => {
  it('hides raw added and removed secret-looking values from /api/runs/:id/diff', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    // The fixture commits an `.env` line on main, then changes it on the
    // feature branch so the three-dot diff emits one removed and one
    // added secret line.
    const git = await createSecretDiffWorktree('feature/diff-redact', {
      envPath: '.env',
      baseContent: 'OPENAI_API_KEY=sk-oldsecret123\n',
      headContent: 'OPENAI_API_KEY=sk-supersecret456\n',
    })
    cleanupDirs.push(git.rootDir)

    fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: git.branch,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: [git.worktreePath],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-06-30T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${runId}/diff`)

    expect(result.response.status).toBe(200)
    // The serialized response must not leak the raw secret values.
    expect(result.text).not.toContain('sk-oldsecret123')
    expect(result.text).not.toContain('sk-supersecret456')
    // The shared redactor marks the substitution explicitly.
    expect(result.text).toContain('[redacted]')
    // Non-secret diff metadata is preserved for the dashboard.
    expect(result.text).toContain('.env')
    expect(result.text).toContain('"base":"main"')
    expect(result.text).toContain('"totals"')
    expect(result.json).toMatchObject({
      base: 'main',
      files: [expect.objectContaining({ path: '.env', status: 'text' })],
      totals: expect.objectContaining({ files: 1, insertions: 1, deletions: 1 }),
      truncated: false,
    })
  })

  it('preserves ordinary diff content while redacting bare token-looking secrets', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createSecretDiffWorktree('feature/diff-bare', {
      envPath: 'src/config.ts',
      baseContent: 'export const version = 1\n',
      headContent: [
        'export const version = 2',
        '// ghp_baretokenwithoutkey123 was added inline',
        'export const note = "sk-inlinetokenwithoutkey890"',
        '',
      ].join('\n'),
    })
    cleanupDirs.push(git.rootDir)

    fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: git.branch,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: [git.worktreePath],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-06-30T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${runId}/diff`)

    expect(result.response.status).toBe(200)
    expect(result.text).not.toContain('ghp_baretokenwithoutkey123')
    expect(result.text).not.toContain('sk-inlinetokenwithoutkey890')
    expect(result.text).toContain('[redacted]')
    // Non-secret content survives redaction so reviewers keep useful context.
    expect(result.text).toContain('src/config.ts')
    expect(result.text).toContain('export const version = 2')
    expect(result.text).toContain('"base":"main"')
  })
})

interface SecretDiffWorktree {
  rootDir: string
  worktreePath: string
  branch: string
}

async function createSecretDiffWorktree(
  branch: string,
  changes: { envPath: string; baseContent: string; headContent: string },
): Promise<SecretDiffWorktree> {
  const rootDir = await mkdtemp(join(tmpdir(), 'ductum-diff-redact-'))
  const repoPath = join(rootDir, 'repo')
  mkdirSync(repoPath, { recursive: true })
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: repoPath, stdio: 'ignore' })
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'ductum@example.test'])
  git(['config', 'user.name', 'Ductum Tests'])
  writeFileSync(join(repoPath, 'README.md'), '# repo\n')
  const envAbsolutePath = join(repoPath, changes.envPath)
  mkdirSync(dirname(envAbsolutePath), { recursive: true })
  writeFileSync(envAbsolutePath, changes.baseContent)
  git(['add', 'README.md', changes.envPath])
  git(['commit', '-m', 'initial baseline with secret-bearing file'])

  const worktreePath = join(rootDir, 'attempt', 'repo')
  mkdirSync(dirname(worktreePath), { recursive: true })
  execFileSync('git', ['worktree', 'add', worktreePath, '-B', branch], {
    cwd: repoPath,
    stdio: 'ignore',
  })
  const gitWt = (args: string[]): void => {
    execFileSync('git', args, { cwd: worktreePath, stdio: 'ignore' })
  }
  gitWt(['config', 'user.email', 'ductum@example.test'])
  gitWt(['config', 'user.name', 'Ductum Tests'])
  const envWorktreePath = join(worktreePath, changes.envPath)
  mkdirSync(dirname(envWorktreePath), { recursive: true })
  writeFileSync(envWorktreePath, changes.headContent)
  gitWt(['add', changes.envPath])
  gitWt(['commit', '-m', 'rotate secret-bearing file'])

  return { rootDir, worktreePath, branch }
}
