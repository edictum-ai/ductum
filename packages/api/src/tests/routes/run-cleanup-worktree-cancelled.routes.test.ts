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

describe('API routes - cancelled attempt cleanup worktree', () => {
  it('cleans a cancelled preserved worktree without requiring task external outcome', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture('ductum/cancelled-attempt', runId)
    cleanupDirs.push(git.rootDir)

    const run = fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'cancelled',
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
      failReason: 'operator stopped duplicate work',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-07-01T08:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cleanup-worktree`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      kind: 'run.cleanup-worktree',
      data: {
        run: { id: run.id, terminalState: 'cancelled', worktreePaths: null },
        externalOutcome: {
          runId: run.id,
          outcome: 'superseded',
          reason: 'operator stopped duplicate work',
        },
        removedWorktreePaths: [git.worktreePath],
      },
    })
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'operator.cancelled-attempt-cleanup',
      removedWorktreePaths: [git.worktreePath],
    })
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toBeNull()
    expect(git.exists()).toEqual({ worktree: false, branch: false })
  })
})

async function createGitWorktreeFixture(branch: string, runId: string) {
  const rootDir = await mkdtemp(join(tmpdir(), 'ductum-cancelled-cleanup-'))
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
