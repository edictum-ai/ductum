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

describe('API routes - failed attempt cleanup worktree', () => {
  it('cleans a failed preserved worktree after task external outcome and keeps failure state intact', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture(`feat/p1-${task.name.toLowerCase().replace(/\s+/g, '-')}`, runId, true)
    cleanupDirs.push(git.rootDir)

    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = fixture.repos.runs.create({
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
      failReason: 'agent crashed before handoff',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    const historyBefore = fixture.repos.runHistory.list(run.id)

    const outcome = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
      method: 'POST',
      body: { outcome: 'fixed', reason: 'operator fixed it elsewhere' },
    })
    expect(outcome.response.status).toBe(201)

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cleanup-worktree`, {
      method: 'POST',
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      schemaVersion: 1,
      kind: 'run.cleanup-worktree',
      data: {
        run: {
          id: run.id,
          terminalState: 'failed',
          failReason: 'agent crashed before handoff',
          worktreePaths: null,
        },
        externalOutcome: {
          outcome: 'fixed',
          reason: 'operator fixed it elsewhere',
        },
        removedWorktreePaths: [git.worktreePath],
      },
    })
    expect(result.json).toMatchObject({
      data: {
        generatedPaths: expect.arrayContaining([
          expect.objectContaining({ path: git.runCodexHomePath, outcome: 'removed' }),
          expect.objectContaining({ path: git.codexHomeParentPath, outcome: 'removed' }),
        ]),
        branchOutcomes: [
          expect.objectContaining({
            branch: git.branch,
            outcome: 'removed',
          }),
        ],
      },
    })
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBe('failed')
    expect(fixture.repos.runs.get(run.id)?.failReason).toBe('agent crashed before handoff')
    expect(fixture.repos.runHistory.list(run.id)).toEqual(historyBefore)
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'operator.failed-attempt-cleanup',
      externalOutcome: { outcome: 'fixed' },
      removedWorktreePaths: [git.worktreePath],
    })
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toBeNull()
    expect(git.exists()).toEqual({ worktree: false, runCodexHome: false, codexHomeParent: false, branch: false })
  })

  it('retains non-Ductum branches and reports the reason', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture('feature/manual-branch', runId, false)
    cleanupDirs.push(git.rootDir)

    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = fixture.repos.runs.create({
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
      failReason: 'manual repro failed',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
      method: 'POST',
      body: { outcome: 'superseded', reason: 'replaced by a manual branch fix' },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cleanup-worktree`, {
      method: 'POST',
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      data: {
        removedWorktreePaths: [git.worktreePath],
        generatedPaths: [],
        branchOutcomes: [
          expect.objectContaining({
            branch: 'feature/manual-branch',
            outcome: 'retained',
            reason: 'branch is not a Ductum auto branch',
          }),
        ],
      },
    })
    expect(git.exists().branch).toBe(true)
  })

  it('refuses cleanup when no trusted task-level external outcome exists', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const runId = createId<'RunId'>()
    const git = await createGitWorktreeFixture('ductum/no-outcome', runId, true)
    cleanupDirs.push(git.rootDir)

    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = fixture.repos.runs.create({
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
      failReason: 'still failed',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cleanup-worktree`, {
      method: 'POST',
    })

    expect(result.response.status).toBe(409)
    expect(result.json).toMatchObject({
      kind: 'error',
      data: {
        message: expect.stringContaining('trusted task-level external outcome'),
        code: 'run_cleanup_conflict',
      },
    })
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toEqual([git.worktreePath])
    expect(git.exists()).toEqual({ worktree: true, runCodexHome: true, codexHomeParent: true, branch: true })
  })

})

async function createGitWorktreeFixture(branch: string, runId: string, withCodexHome: boolean) {
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
  if (withCodexHome) {
    mkdirSync(runCodexHomePath, { recursive: true })
    writeFileSync(join(runCodexHomePath, 'config.toml'), '# generated\n')
  }

  return {
    rootDir,
    repoPath,
    worktreePath,
    branch,
    codexHomeParentPath,
    runCodexHomePath,
    exists() {
      return {
        worktree: exists(worktreePath),
        runCodexHome: exists(runCodexHomePath),
        codexHomeParent: exists(codexHomeParentPath),
        branch: localBranchExists(repoPath, branch),
      }
    },
  }
}

function exists(path: string): boolean {
  return existsSync(path)
}

function localBranchExists(repoPath: string, branch: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], { cwd: repoPath, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
