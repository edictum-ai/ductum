import { describe, expect, it } from 'vitest'

import { buildExecutionRepairItems } from '../repair-execution.js'

describe('repair execution', () => {
  it('turns execution integrity failures into attempt recovery repair items', () => {
    const items = buildExecutionRepairItems({
      runs: [{
        runId: 'run-1',
        taskId: 'task-1',
        taskName: 'Task 1',
        specName: 'Spec 1',
        projectName: 'Project 1',
        executionIssues: [{ code: 'done_run_without_lineage_or_external_outcome' }],
      }],
      tasks: [{
        taskId: 'task-2',
        taskName: 'Task 2',
        taskStatus: 'done',
        specId: 'spec-2',
        specName: 'Spec 2',
        projectName: 'Project 2',
        runIds: [],
        executionIssues: [{ code: 'bakeoff_candidate_without_outcome' }],
      }],
    })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'attempt:run-1:done_run_without_lineage_or_external_outcome',
        area: 'attempt_recovery',
        severity: 'attention',
        issueCode: 'done_run_without_lineage_or_external_outcome',
      }),
      expect.objectContaining({
        id: 'task:task-2:bakeoff_candidate_without_outcome',
        area: 'attempt_recovery',
        severity: 'attention',
        issueCode: 'bakeoff_candidate_without_outcome',
      }),
    ])
  })
})
