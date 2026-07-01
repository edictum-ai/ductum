import { createId } from '@ductum/core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

describe('API routes - paused attempt cleanup worktree', () => {
  it('cleans a paused preserved worktree after trusted task external outcome', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture('ductum/paused-attempt', runId)
    cleanupDirs.push(git.rootDir)

    const run = fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'paused',
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
      failReason: 'operator paused duplicate work',
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-07-01T08:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
      method: 'POST',
      body: { outcome: 'fixed', reason: 'operator landed the fix in PR #202' },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cleanup-worktree`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      kind: 'run.cleanup-worktree',
      data: {
        run: { id: run.id, terminalState: 'paused', worktreePaths: null },
        externalOutcome: { outcome: 'fixed', reason: 'operator landed the fix in PR #202' },
        removedWorktreePaths: [git.worktreePath],
      },
    })
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'operator.paused-attempt-cleanup',
      removedWorktreePaths: [git.worktreePath],
    })
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toBeNull()
    expect(git.exists()).toEqual({ worktree: false, branch: false })
  })

  it('refuses paused cleanup without trusted task external outcome', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture('ductum/paused-without-outcome', runId)
    cleanupDirs.push(git.rootDir)

    const run = fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'paused',
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
      failReason: 'operator paused for inspection',
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-07-01T08:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cleanup-worktree`, { method: 'POST' })

    expect(result.response.status).toBe(409)
    expect(result.json).toMatchObject({
      data: {
        code: 'run_cleanup_conflict',
        message: expect.stringContaining('trusted task-level external outcome'),
      },
    })
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toEqual([git.worktreePath])
    expect(git.exists()).toEqual({ worktree: true, branch: true })
  })
})

async function createGitWorktreeFixture(branch: string, runId: string) {
  const rootDir = await mkdtemp(join(tmpdir(), 'ductum-paused-cleanup-'))
  const repoPath = join(rootDir, 'repo')
  mkdirSync(repoPath, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath })
  execFileSync('git', ['config', 'user.email', 'ductum@example.test'], { cwd: repoPath })
  execFileSync('git', ['config', 'user.name', 'Ductum Tests'], { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# repo\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoPath })

  const worktreePath = join(rootDir, 'attempt', 'repo')
  mkdirSync(dirname(worktreePath), { recursive: true })
  execFileSync('git', ['worktree', 'add', worktreePath, '-B', branch], { cwd: repoPath })
  mkdirSync(join(dirname(worktreePath), '.codex-home', runId), { recursive: true })

  return {
    rootDir,
    worktreePath,
    branch,
    exists() {
      return {
        worktree: existsSync(worktreePath),
        branch: branchExists(repoPath, branch),
      }
    },
  }
}

function branchExists(repoPath: string, branch: string): boolean {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoPath })
    return true
  } catch {
    return false
  }
}
