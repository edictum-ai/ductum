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

describe('API routes - failed attempt cleanup with merged sibling', () => {
  it('trusts a sibling merged GitHub lifecycle run when no manual external outcome exists', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture('ductum/cleanup-after-merge', runId)
    cleanupDirs.push(git.rootDir)

    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const failedRun = fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
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
      failReason: 'stale generated worktree',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    const mergedRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement', 'ship'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'feat/final-success',
      commitSha: 'abc123',
      prNumber: 135,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/135',
      worktreePaths: null,
      ciStatus: 'pass',
      reviewStatus: 'pass',
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T11:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: mergedRun.id,
      type: 'custom',
      payload: { kind: 'github-pr-merge', prNumber: 135, prUrl: mergedRun.prUrl },
    })

    const result = await requestJson(fixture.app, `/api/runs/${failedRun.id}/cleanup-worktree`, {
      method: 'POST',
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      data: {
        externalOutcome: {
          runId: mergedRun.id,
          outcome: 'done',
          reason: expect.stringContaining('PR #135'),
        },
      },
    })
  })
})

async function createGitWorktreeFixture(branch: string, runId: string) {
  const rootDir = await mkdtemp(join(tmpdir(), 'ductum-failed-cleanup-'))
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

  const codexHomeParentPath = join(dirname(worktreePath), '.codex-home')
  const runCodexHomePath = join(codexHomeParentPath, runId)
  mkdirSync(runCodexHomePath, { recursive: true })
  writeFileSync(join(runCodexHomePath, 'config.toml'), '# generated\n')

  return {
    rootDir,
    repoPath,
    worktreePath,
    branch,
    codexHomeParentPath,
    runCodexHomePath,
    exists() {
      return {
        worktree: existsSync(worktreePath),
        runCodexHome: existsSync(runCodexHomePath),
        codexHomeParent: existsSync(codexHomeParentPath),
      }
    },
  }
}
