import { describe, expect, it, vi } from 'vitest'
import type { Evidence, Run } from '@ductum/core'

import { activeRun, activeTask, createMockApi, readyTask, runCommand, stalledRun, stalledTask } from './helpers.js'

describe('ductum status command', () => {
  it('emits a schema envelope by default in non-TTY mode', async () => {
    const result = await runCommand(['status'])
    const payload = JSON.parse(result.text) as {
      kind?: string
      data?: { nextActions?: string[] }
    }

    expect(result.code).toBe(0)
    expect(payload.kind).toBe('status.overview')
    expect(payload.data?.nextActions).toBeInstanceOf(Array)
  })

  it('puts repair ahead of approvals and ready work in next operator actions', async () => {
    const approvalTask = {
      ...readyTask,
      id: 'task-approval' as typeof readyTask.id,
      name: 'Approval Task',
      status: 'active' as const,
      updatedAt: '2026-06-25T11:00:00.000Z',
    }
    const approvalRun = {
      ...activeRun,
      id: 'run-approval' as typeof activeRun.id,
      taskId: approvalTask.id,
      stage: 'ship' as const,
      pendingApproval: true,
      updatedAt: '2026-06-25T11:00:00.000Z',
    }
    const api = createMockApi({
      listTasks: vi.fn().mockResolvedValue([readyTask, activeTask, stalledTask, approvalTask]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
        if (taskId === activeTask.id) return [activeRun]
        if (taskId === stalledTask.id) return [stalledRun]
        if (taskId === approvalTask.id) return [approvalRun]
        return []
      }),
    })

    const result = await runCommand(['--human', 'status'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('Next Operator Actions')
    const nextActions = result.text.slice(result.text.indexOf('Next Operator Actions'))
    expect(nextActions).toContain('1. A failed or stalled Attempt needs operator action. Next: ductum retry run-stalled')
    expect(nextActions).not.toContain('1. An Attempt is waiting for operator approval.')
  })

  it('shows exact dirty partial worktree files and recovery guidance', async () => {
    const run: Run = {
      ...stalledRun,
      id: 'attempt-dirty-status-aaaaaa' as Run['id'],
      terminalState: 'failed',
      failReason: 'prompt_overflow',
    }
    const api = createMockApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunHistory: vi.fn().mockResolvedValue([]),
      getRunGateEvaluations: vi.fn().mockResolvedValue([]),
      getRunEvidence: vi.fn().mockResolvedValue([{
        id: 'evidence-dirty' as Evidence['id'],
        runId: run.id,
        type: 'custom',
        createdAt: '2026-06-25T10:00:00.000Z',
        payload: {
          kind: 'worktree.dirty_partial',
          terminalState: 'failed',
          failReason: 'prompt_overflow',
          worktreePath: '/tmp/dirty',
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
            patchCommand: `git -C '/tmp/dirty' diff > 'attempt-${run.id.slice(0, 8)}-partial.patch'`,
            cleanupNote: 'Save a patch or branch first, then remove the preserved worktree manually.',
          },
        },
      }]),
    })

    const result = await runCommand(['--human', 'status', run.id], api)

    expect(result.text).toContain('Dirty Partial Worktree')
    expect(result.text).toContain('packages/core/src/db-migrations.ts')
    expect(result.text).toContain('packages/core/src/types.ts')
    expect(result.text).toContain('packages/core/src/repos/task-dispatch-skip.ts')
    expect(result.text).toContain(`ductum logs ${run.id} --limit 80`)
    expect(result.text).toContain(`git -C '/tmp/dirty' diff > 'attempt-${run.id.slice(0, 8)}-partial.patch'`)
  })
})
