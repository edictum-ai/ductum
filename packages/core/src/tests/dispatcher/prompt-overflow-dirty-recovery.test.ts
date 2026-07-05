import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { afterEach } from 'vitest'

import { buildDirtyPartialWorktreeEvidence } from '../../dispatcher-dirty-worktree.js'
import { createFixture, createTask, describe, expect, flush, it, vi, type WorktreeManager } from './shared.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Dispatcher - prompt overflow dirty recovery', () => {
  it('records exact dirty tracked and untracked files after bounded prompt overflow writes', async () => {
    const worktree = createRepo()
    const fixture = createFixture({
      recordEvidence: true,
      resolveRepoPath: () => worktree,
      worktreeManager: fakeWorktreeManager(worktree),
    })
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, [worktree])

    writeFileSync(join(worktree, 'packages/core/src/db-migrations.ts'), 'export const migration = 2\n')
    writeFileSync(join(worktree, 'packages/core/src/types.ts'), 'export const types = 2\n')
    execFileSync('git', ['-C', worktree, 'add', 'packages/core/src/types.ts'])
    writeFileSync(join(worktree, 'packages/core/src/repos/task-dispatch-skip.ts'), 'export const skip = true\n')

    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: true,
      },
      tokensIn: 100,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    for (let i = 0; i < 40 && fixture.context.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'worktree.dirty_partial') == null; i += 1) {
      await delay(100)
    }

    const updated = fixture.context.runRepo.get(run.id)!
    expect(updated.terminalState).toBe('frozen')
    expect(updated.failReason).toContain('max_turns_paused: attempt input tokens per turn')
    const dirtyEvidence = fixture.context.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'worktree.dirty_partial')
    expect(dirtyEvidence?.payload).toMatchObject({
      kind: 'worktree.dirty_partial',
      terminalState: 'frozen',
      paths: [
        'packages/core/src/db-migrations.ts',
        'packages/core/src/repos/task-dispatch-skip.ts',
        'packages/core/src/types.ts',
      ],
      trackedPaths: [
        'packages/core/src/db-migrations.ts',
        'packages/core/src/types.ts',
      ],
      untrackedPaths: [
        'packages/core/src/repos/task-dispatch-skip.ts',
      ],
      recovery: {
        statusCommand: `ductum status ${run.id}`,
        logsCommand: `ductum logs ${run.id} --limit 80`,
        resumeCommand: null,
        retryBlocked: true,
        patchCommand: expect.stringContaining('diff --binary --cached'),
      },
    })
  })

  it('only suggests Ductum resume for paused dirty attempts', () => {
    const snapshot = {
      worktreePath: '/tmp/dirty-worktree',
      trackedPaths: ['src/a.ts'],
      untrackedPaths: [],
      relevantPaths: ['src/a.ts'],
      ignoredPaths: [],
    }

    expect(buildDirtyPartialWorktreeEvidence({
      id: 'run-stalled' as never,
      terminalState: 'stalled',
      failReason: 'prompt_overflow',
    }, snapshot).recovery.resumeCommand).toBeNull()
    expect(buildDirtyPartialWorktreeEvidence({
      id: 'run-frozen' as never,
      terminalState: 'frozen',
      failReason: 'prompt_overflow',
    }, snapshot).recovery.resumeCommand).toBeNull()
    expect(buildDirtyPartialWorktreeEvidence({
      id: 'run-paused' as never,
      terminalState: 'paused',
      failReason: 'operator_pause',
    }, snapshot).recovery.resumeCommand).toBe('ductum attempt resume run-paused --reason "continue preserved worktree"')
  })
})

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ductum-overflow-'))
  cleanup.push(repo)
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test'])
  execFileSync('mkdir', ['-p', join(repo, 'packages/core/src/repos')])
  writeFileSync(join(repo, 'packages/core/src/db-migrations.ts'), 'export const migration = 1\n')
  writeFileSync(join(repo, 'packages/core/src/types.ts'), 'export const types = 1\n')
  execFileSync('git', ['-C', repo, 'add', 'packages/core/src/db-migrations.ts', 'packages/core/src/types.ts'])
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed'])
  return repo
}

function fakeWorktreeManager(worktree: string) {
  return {
    get enabled() { return true },
    get cleanupOnSuccess() { return true },
    get cleanupOnFailure() { return true },
    isGitRepo: () => true,
    create: vi.fn(async () => worktree),
    remove: vi.fn(async () => undefined),
    restore: vi.fn(async () => worktree),
    cleanupStale: vi.fn(async () => 0),
  } as unknown as WorktreeManager
}
