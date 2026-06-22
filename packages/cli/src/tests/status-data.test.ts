import type { Run, Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { deriveRunStage, findOpenWorkflowFollowup, listNeedsOperatorRuns } from '../commands/status-data.js'
import type { WorkspaceSnapshot } from '../types.js'
import { activeRun, activeTask, agent, project, repository, spec } from './helpers.js'

describe('status-data followup selection', () => {
  it('prefers a ready review over an older open fix task', () => {
    const oldFix = task('task-fix-1', 'fix-Active Task-r1', 'active')
    const currentFix = task('task-fix-2', 'fix-Active Task-r2', 'active')
    const review = task('task-review-3', 'review-Active Task-r3', 'ready')
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [activeTask, oldFix, currentFix, review],
      taskDependencies: [],
      runs: [{ ...activeRun, taskId: currentFix.id }],
    }

    expect(findOpenWorkflowFollowup(snapshot, { taskId: currentFix.id })?.task.id).toBe(review.id)
  })
})

function task(id: string, name: string, status: Task['status']): Task {
  return {
    ...activeTask,
    id: id as Task['id'],
    name,
    requiredRole: name.startsWith('review-') ? 'reviewer' : 'builder',
    status,
  }
}

describe('status-data quarantine legibility', () => {
  it('derives a quarantined run stage and surfaces it as needs-operator', () => {
    const qTask = { ...activeTask, id: 'task-q' as Task['id'], name: 'Active Task', status: 'active' as Task['status'] }
    const qRun: Run = {
      ...activeRun,
      id: 'run-q' as Run['id'],
      taskId: qTask.id,
      stage: 'implement',
      terminalState: 'quarantined',
      pendingApproval: false,
      failReason: 'deterministic poison',
    }
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [qTask],
      taskDependencies: [],
      runs: [qRun],
    }

    // Same derived stage as the core derivation, and visible as needs-operator.
    expect(deriveRunStage(qRun)).toBe('quarantined')
    const needsOperator = listNeedsOperatorRuns(snapshot, new Date('2026-06-18T12:00:00.000Z'))
    expect(needsOperator.map((record) => record.run.id)).toContain('run-q')
  })
})


describe('status-data failed review legibility', () => {
  it('surfaces a failed review task even when the parent implementation attempt is complete', () => {
    const implTask = { ...activeTask, id: 'task-impl' as Task['id'], name: 'P1', status: 'active' as Task['status'] }
    const reviewTask = {
      ...activeTask,
      id: 'task-review' as Task['id'],
      name: 'review-P1',
      requiredRole: 'reviewer' as Task['requiredRole'],
      status: 'failed' as Task['status'],
    }
    const implRun: Run = { ...activeRun, id: 'run-impl' as Run['id'], taskId: implTask.id, stage: 'done', terminalState: null }
    const reviewRun: Run = {
      ...activeRun,
      id: 'run-review' as Run['id'],
      taskId: reviewTask.id,
      parentRunId: implRun.id,
      stage: 'implement',
      terminalState: 'failed',
      failReason: 'malformed reviewer completion',
    }
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [implTask, reviewTask],
      taskDependencies: [],
      runs: [implRun, reviewRun],
    }

    expect(listNeedsOperatorRuns(snapshot, new Date('2026-06-22T12:00:00.000Z')).map((record) => record.run.id)).toEqual(['run-review'])
  })

  it('surfaces a failed builder fix task whose latest run stalled', () => {
    const fixTask = {
      ...activeTask,
      id: 'task-fix' as Task['id'],
      name: 'fix-P6-r2',
      requiredRole: 'builder' as Task['requiredRole'],
      status: 'failed' as Task['status'],
    }
    const fixRun: Run = {
      ...activeRun,
      id: 'run-fix-stalled' as Run['id'],
      taskId: fixTask.id,
      stage: 'implement',
      terminalState: 'stalled',
      failReason: 'stale_slot_gc',
    }
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [fixTask],
      taskDependencies: [],
      runs: [fixRun],
    }

    expect(listNeedsOperatorRuns(snapshot, new Date('2026-06-22T12:00:00.000Z')).map((record) => record.run.id)).toEqual(['run-fix-stalled'])
  })
})
