import { createId } from '@ductum/core'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

describe('API routes - run diff safety', () => {
  it('does not execute worktree-configured git helpers', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createDiffWorktree()
    cleanupDirs.push(git.rootDir)
    const markerPath = join(git.rootDir, 'external-diff-ran')
    const fsmonitorMarkerPath = join(git.rootDir, 'fsmonitor-ran')
    const helperPath = join(git.rootDir, 'external-diff.sh')
    const fsmonitorPath = join(git.rootDir, 'fsmonitor.sh')
    writeFileSync(helperPath, `#!/bin/sh\nprintf ran > ${JSON.stringify(markerPath)}\nexit 42\n`)
    writeFileSync(fsmonitorPath, `#!/bin/sh\nprintf ran > ${JSON.stringify(fsmonitorMarkerPath)}\nexit 42\n`)
    chmodSync(helperPath, 0o755)
    chmodSync(fsmonitorPath, 0o755)
    execFileSync('git', ['-C', git.worktreePath, 'config', 'diff.external', helperPath], { stdio: 'ignore' })
    execFileSync('git', ['-C', git.worktreePath, 'config', 'core.fsmonitor', fsmonitorPath], { stdio: 'ignore' })

    fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
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
      failReason: 'prompt_overflow',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-06-30T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${runId}/diff`)

    expect(result.response.status).toBe(200)
    expect(result.text).toContain('src/config.ts')
    expect(existsSync(markerPath)).toBe(false)
    expect(existsSync(fsmonitorMarkerPath)).toBe(false)
  })

  it('rejects option-like diff base values before invoking git diff', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createDiffWorktree()
    cleanupDirs.push(git.rootDir)

    fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
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
      failReason: 'prompt_overflow',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-06-30T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${runId}/diff?base=--ext-diff`)

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('Invalid diff base')
  })

  it('marks tracked diff text collection failures as truncated', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createDiffWorktree()
    cleanupDirs.push(git.rootDir)
    writeFileSync(join(git.worktreePath, 'src/huge.txt'), 'x'.repeat(9 * 1024 * 1024))
    execFileSync('git', ['-C', git.worktreePath, 'add', 'src/huge.txt'], { stdio: 'ignore' })
    execFileSync('git', ['-C', git.worktreePath, 'commit', '-m', 'add huge diff'], { stdio: 'ignore' })

    fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
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
      failReason: 'prompt_overflow',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-06-30T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${runId}/diff`)

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({ truncated: true })
    expect(result.text).toContain('failed to collect diff text')
    expect(result.text).toContain('src/huge.txt')
  })
})

interface DiffWorktree {
  rootDir: string
  worktreePath: string
  branch: string
}

async function createDiffWorktree(): Promise<DiffWorktree> {
  const rootDir = await mkdtemp(join(tmpdir(), 'ductum-diff-safety-'))
  const repoPath = join(rootDir, 'repo')
  mkdirSync(repoPath, { recursive: true })
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: repoPath, stdio: 'ignore' })
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'ductum@example.test'])
  git(['config', 'user.name', 'Ductum Tests'])
  mkdirSync(join(repoPath, 'src'), { recursive: true })
  writeFileSync(join(repoPath, 'src/config.ts'), 'export const version = 1\n')
  git(['add', 'src/config.ts'])
  git(['commit', '-m', 'initial baseline'])

  const branch = 'feature/external-diff-disabled'
  const worktreePath = join(rootDir, 'attempt', 'repo')
  mkdirSync(dirname(worktreePath), { recursive: true })
  execFileSync('git', ['worktree', 'add', worktreePath, '-B', branch], { cwd: repoPath, stdio: 'ignore' })
  writeFileSync(join(worktreePath, 'src/config.ts'), 'export const version = 2\n')
  execFileSync('git', ['-C', worktreePath, 'add', 'src/config.ts'], { stdio: 'ignore' })
  execFileSync('git', ['-C', worktreePath, 'commit', '-m', 'change config'], { stdio: 'ignore' })
  return { rootDir, worktreePath, branch }
}
