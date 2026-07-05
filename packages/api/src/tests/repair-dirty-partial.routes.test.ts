import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

const execFileAsync = promisify(execFile)

let fixture: TestFixture | undefined
let worktreeRoot: string | undefined

afterEach(async () => {
  fixture?.close()
  fixture = undefined
  if (worktreeRoot != null) {
    await rm(worktreeRoot, { recursive: true, force: true })
    worktreeRoot = undefined
  }
})

describe('repair routes - dirty partial worktree recovery', () => {
  it('surfaces exact file paths and recovery guidance', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    worktreeRoot = await mkdtemp(join(tmpdir(), 'ductum-repair-dirty-'))
    await execFileAsync('git', ['init', '-q', worktreeRoot])
    await execFileAsync('git', ['-C', worktreeRoot, 'config', 'user.email', 'test@example.com'])
    await execFileAsync('git', ['-C', worktreeRoot, 'config', 'user.name', 'Test'])
    await execFileAsync('mkdir', ['-p', join(worktreeRoot, 'packages/core/src/repos')])
    await writeFile(join(worktreeRoot, 'packages/core/src/db-migrations.ts'), 'export const migration = 1\n')
    await writeFile(join(worktreeRoot, 'packages/core/src/types.ts'), 'export const type = 1\n')
    await execFileAsync('git', ['-C', worktreeRoot, 'add', 'packages/core/src/db-migrations.ts', 'packages/core/src/types.ts'])
    await execFileAsync('git', ['-C', worktreeRoot, 'commit', '-qm', 'seed'])
    await writeFile(join(worktreeRoot, 'packages/core/src/db-migrations.ts'), 'export const migration = 2\n')
    await writeFile(join(worktreeRoot, 'packages/core/src/types.ts'), 'export const type = 2\n')
    await writeFile(join(worktreeRoot, 'packages/core/src/repos/task-dispatch-skip.ts'), 'export const dirty = true\n')
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-1',
      branch: 'feat/dirty',
      commitSha: 'abc123',
      prNumber: null,
      prUrl: null,
      worktreePaths: [worktreeRoot],
      ciStatus: null,
      reviewStatus: null,
      failReason: 'prompt_overflow',
      recoverable: false,
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
        kind: 'worktree.dirty_partial',
        terminalState: 'failed',
        failReason: 'prompt_overflow',
        worktreePath: worktreeRoot,
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
        ignoredPaths: [],
        recovery: {
          statusCommand: `ductum status ${run.id}`,
          logsCommand: `ductum logs ${run.id} --limit 80`,
          resumeCommand: null,
          retryBlocked: true,
          patchCommand: `git -C '${worktreeRoot}' diff > 'attempt-${run.id.slice(0, 8)}-partial.patch'`,
          cleanupNote: `Save a patch or branch first. After a trusted external outcome exists, run ductum attempt cleanup ${run.id} --worktree to remove the preserved worktree.`,
        },
      },
    })

    const result = await requestJson(fixture.app, '/api/repair')

    expect(result.response.status).toBe(200)
    const body = result.json as { items?: Array<{ issueCode: string | null; field: { value: string }; suggestedAction: string }> }
    const item = body.items?.find((candidate) => candidate.issueCode === 'dirty_partial_worktree')
    expect(item?.field.value).toContain('packages/core/src/db-migrations.ts')
    expect(item?.field.value).toContain('packages/core/src/types.ts')
    expect(item?.field.value).toContain('packages/core/src/repos/task-dispatch-skip.ts')
    expect(item?.suggestedAction).toContain(`ductum logs ${run.id} --limit 80`)
    expect(item?.suggestedAction).toContain('Retry remains blocked until the dirty worktree is cleaned up safely.')
  })

  it('drops stale dirty-partial evidence when the preserved worktree path is gone', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    // Unique path that does not exist on disk and is removed before the
    // assertion so the stale-evidence branch is deterministic.
    const staleRoot = await mkdtemp(join(tmpdir(), 'ductum-repair-stale-'))
    await rm(staleRoot, { recursive: true, force: true })
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-2',
      branch: 'feat/dirty',
      commitSha: 'abc234',
      prNumber: null,
      prUrl: null,
      worktreePaths: [staleRoot],
      ciStatus: null,
      reviewStatus: null,
      failReason: 'prompt_overflow',
      recoverable: false,
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
        kind: 'worktree.dirty_partial',
        terminalState: 'failed',
        failReason: 'prompt_overflow',
        worktreePath: staleRoot,
        paths: ['packages/core/src/db-migrations.ts'],
        trackedPaths: ['packages/core/src/db-migrations.ts'],
        untrackedPaths: [],
        ignoredPaths: [],
        recovery: {
          statusCommand: `ductum status ${run.id}`,
          logsCommand: `ductum logs ${run.id} --limit 80`,
          resumeCommand: null,
          retryBlocked: true,
          patchCommand: `git -C '${staleRoot}' diff > 'attempt-${run.id.slice(0, 8)}-partial.patch'`,
          cleanupNote: `Save a patch or branch first. After a trusted external outcome exists, run ductum attempt cleanup ${run.id} --worktree to remove the preserved worktree.`,
        },
      },
    })

    const result = await requestJson(fixture.app, '/api/repair')

    expect(result.response.status).toBe(200)
    const body = result.json as { items?: Array<{ issueCode: string | null }> }
    const item = body.items?.find((candidate) => candidate.issueCode === 'dirty_partial_worktree')
    expect(item).toBeUndefined()
  })
})
