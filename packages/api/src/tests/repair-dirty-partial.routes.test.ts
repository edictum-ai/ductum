import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('repair routes - dirty partial worktree recovery', () => {
  it('surfaces exact file paths and recovery guidance', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
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
      worktreePaths: ['/tmp/dirty-worktree'],
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
        worktreePath: '/tmp/dirty-worktree',
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
          patchCommand: `git -C '/tmp/dirty-worktree' diff > 'attempt-${run.id.slice(0, 8)}-partial.patch'`,
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
})
