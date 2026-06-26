import { describe, expect, it, vi } from 'vitest'
import type { RepairReport, Run } from '@ductum/core'

import { activeTask, createMockApi, emptyRepairReport, readyTask, runCommand, stalledRun, stalledTask } from './helpers.js'

describe('ductum repair command - dirty worktree recovery', () => {
  it('does not advertise retry when repair already reports dirty partial files', async () => {
    const dirtyRun: Run = {
      ...stalledRun,
      id: 'attempt-dirty-partial-aaaaaa' as Run['id'],
      terminalState: 'failed',
      failReason: 'prompt_overflow',
    }
    const report: RepairReport = {
      ...emptyRepairReport(),
      items: [
        repairItem('attempt-recovery:needs-operator', 'attempt_recovery', '1 attempt stopped and needs a decision'),
        {
          ...repairItem(`attempt:${dirtyRun.id}:dirty_partial_worktree`, 'attempt_recovery', 'Attempt stopped with dirty partial worktree'),
          severity: 'attention',
          issueCode: 'dirty_partial_worktree',
          target: { attemptId: dirtyRun.id, taskId: stalledTask.id, taskName: stalledTask.name, projectName: 'ductum', specName: 'P6' },
          field: {
            path: `attempts.${dirtyRun.id}.worktree.paths`,
            label: 'Dirty worktree files',
            value: 'packages/core/src/db-migrations.ts, packages/core/src/types.ts, packages/core/src/repos/task-dispatch-skip.ts',
          },
          suggestedAction: 'Inspect status/logs, export a patch, and clean the preserved worktree before retrying.',
        },
      ],
      groups: [{
        area: 'attempt_recovery',
        label: 'Attempt recovery',
        blocks: 'Blocks tasks whose latest Attempt needs an operator decision.',
        items: [],
      }],
      summary: {
        ...emptyRepairReport().summary,
        total: 2,
        attention: 2,
        byArea: { ...emptyRepairReport().summary.byArea, attempt_recovery: 2 },
      },
    }
    report.groups[0]!.items = report.items
    const api = createMockApi({
      getRepairReport: vi.fn().mockResolvedValue(report),
      listTasks: vi.fn().mockResolvedValue([readyTask, activeTask, stalledTask]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => taskId === stalledTask.id ? [dirtyRun] : []),
    })

    const result = await runCommand(['repair', 'list'], api)

    expect(result.text).toContain(`attempt: ${dirtyRun.id}`)
    expect(result.text).toContain('Dirty worktree files')
    expect(result.text).toContain('packages/core/src/repos/task-dispatch-skip.ts')
    expect(result.text).not.toContain(`ductum retry ${dirtyRun.id}`)
  })
})

function repairItem(id: string, area: RepairReport['items'][number]['area'], title: string): RepairReport['items'][number] {
  return {
    id,
    area,
    severity: 'blocker',
    title,
    reason: `${title}.`,
    suggestedAction: 'Open Factory Settings and fix the selected item.',
    record: { type: 'Provider', id: 'provider:openai', name: 'OpenAI' },
    field: {
      path: 'providers.openai.auth',
      label: 'Provider auth',
      value: '(missing)',
    },
    blocks: 'Blocks agents whose provider is not authenticated.',
    status: 'missing',
    issueCode: null,
    target: null,
    href: null,
    linkLabel: null,
  }
}
