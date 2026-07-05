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

describe('POST /api/runs/:runId/retry - stale dirty worktree recovery', () => {
  it('unblocks retry when the preserved dirty-partial worktree path is gone', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    // Use a unique path that does not exist on disk; remove it before the
    // assertion so the stale-evidence branch is deterministic and the test
    // never depends on a leftover directory from a prior run.
    const staleRoot = await mkdtemp(join(tmpdir(), 'ductum-retry-stale-'))
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
      sessionId: null,
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
        paths: ['packages/api/src/lib/dirty-attempt-recovery.ts'],
        trackedPaths: ['packages/api/src/lib/dirty-attempt-recovery.ts'],
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

    // The retry path no longer raises the dirty-worktree ValidationError
    // because the preserved path is gone and no partial work can be saved.
    // The request still fails (the run is not retry-eligible in this bare
    // fixture), but the failure must NOT be the dirty-worktree block.
    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, { method: 'POST' })

    expect(String((result.json as { error?: unknown }).error)).not.toContain('Retry blocked')
    expect(String((result.json as { error?: unknown }).error)).not.toContain('preserved dirty worktree')
  })

  it('still blocks retry when the preserved dirty-partial worktree path is live', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    worktreeRoot = await mkdtemp(join(tmpdir(), 'ductum-retry-live-'))
    await execFileAsync('git', ['init', '-q', worktreeRoot])
    await execFileAsync('git', ['-C', worktreeRoot, 'config', 'user.email', 'test@example.com'])
    await execFileAsync('git', ['-C', worktreeRoot, 'config', 'user.name', 'Test'])
    await execFileAsync('mkdir', ['-p', join(worktreeRoot, 'packages/api/src/lib')])
    await writeFile(join(worktreeRoot, 'packages/api/src/lib/dirty-attempt-recovery.ts'), 'export const x = 1\n')
    await execFileAsync('git', ['-C', worktreeRoot, 'add', 'packages/api/src/lib/dirty-attempt-recovery.ts'])
    await execFileAsync('git', ['-C', worktreeRoot, 'commit', '-qm', 'seed'])
    await writeFile(join(worktreeRoot, 'packages/api/src/lib/dirty-attempt-recovery.ts'), 'export const x = 2\n')
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
      sessionId: null,
      branch: 'feat/dirty',
      commitSha: 'abc345',
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
        paths: ['packages/api/src/lib/dirty-attempt-recovery.ts'],
        trackedPaths: ['packages/api/src/lib/dirty-attempt-recovery.ts'],
        untrackedPaths: [],
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

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, { method: 'POST' })

    expect(result.response.status).toBe(400)
    expect(String((result.json as { error?: unknown }).error)).toContain('Retry blocked')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
  })
})
