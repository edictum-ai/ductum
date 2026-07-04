import type { Run, Task, TaskDependency } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { deriveRunStage, findOpenWorkflowFollowup, listNeedsOperatorRuns, listReadyTasks } from '../commands/status-data.js'
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

  it('hides an older same-lineage fix from a current newer fix run', () => {
    const oldFix = task('task-fix-1', 'fix-Active Task-r1', 'active')
    const currentFix = task('task-fix-2', 'fix-Active Task-r2', 'active')
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [activeTask, oldFix, currentFix],
      taskDependencies: [],
      runs: [{ ...activeRun, taskId: currentFix.id }],
    }

    expect(findOpenWorkflowFollowup(snapshot, { taskId: currentFix.id })).toBeNull()
  })

  it('hides a same-round same-lineage fix from a current fix run', () => {
    const sameRoundA = task('task-fix-a', 'fix-Active Task-r2', 'active')
    const sameRoundB = task('task-fix-b', 'fix-Active Task-r2', 'active')
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [activeTask, sameRoundA, sameRoundB],
      taskDependencies: [],
      runs: [{ ...activeRun, taskId: sameRoundB.id }],
    }

    expect(findOpenWorkflowFollowup(snapshot, { taskId: sameRoundB.id })).toBeNull()
  })

  it('still surfaces an open fix follow-up for an implementation task', () => {
    const impl = { ...activeTask, id: 'task-impl' as Task['id'], name: 'Active Task' }
    const openFix = task('task-fix-1', 'fix-Active Task-r1', 'active')
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [impl, openFix],
      taskDependencies: [],
      runs: [{ ...activeRun, taskId: impl.id }],
    }

    expect(findOpenWorkflowFollowup(snapshot, { taskId: impl.id })?.task.id).toBe(openFix.id)
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

describe('status-data ready task eligibility', () => {
  it('does not advertise draft-spec ready tasks as dispatchable', () => {
    const approvedTask = task('task-approved-ready', 'Approved Ready Task', 'ready')
    const draftSpec = {
      ...spec,
      id: 'spec-draft' as typeof spec.id,
      status: 'draft' as typeof spec.status,
    }
    const draftTask = {
      ...approvedTask,
      id: 'task-draft-ready' as Task['id'],
      specId: draftSpec.id,
      name: 'Draft Ready Task',
    }
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec, draftSpec],
      tasks: [approvedTask, draftTask],
      taskDependencies: [],
      runs: [],
    }

    expect(listReadyTasks(snapshot).map((record) => record.task.id)).toEqual([approvedTask.id])
  })

  it('mirrors dispatcher dependency and open-run gating for ready tasks', () => {
    const doneDependency = task('task-done-dep', 'Done Dependency', 'done')
    const pendingDependency = task('task-pending-dep', 'Pending Dependency', 'pending')
    const failedDependency = task('task-failed-dep', 'Failed Dependency', 'failed')
    const readyWithDoneDependency = task('task-ready-done-dep', 'Ready Done Dep', 'ready')
    const readyWithPendingDependency = task('task-ready-pending-dep', 'Ready Pending Dep', 'ready')
    const blindReviewWithFailedDependency = {
      ...task('task-blind-failed-dep', 'Blind Review Failed Dep', 'ready'),
      strategyRole: 'blind_review' as const,
    }
    const readyWithOpenRun = task('task-ready-open-run', 'Ready Open Run', 'ready')
    const openRun: Run = {
      ...activeRun,
      id: 'run-ready-open' as Run['id'],
      taskId: readyWithOpenRun.id,
      stage: 'implement',
      terminalState: null,
    }
    const dependenciesForReadyTasks: TaskDependency[] = [
      { taskId: readyWithDoneDependency.id, dependsOnId: doneDependency.id },
      { taskId: readyWithPendingDependency.id, dependsOnId: pendingDependency.id },
      { taskId: blindReviewWithFailedDependency.id, dependsOnId: failedDependency.id },
    ]
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [repository],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [
        doneDependency,
        pendingDependency,
        failedDependency,
        readyWithDoneDependency,
        readyWithPendingDependency,
        blindReviewWithFailedDependency,
        readyWithOpenRun,
      ],
      taskDependencies: dependenciesForReadyTasks,
      runs: [openRun],
    }

    expect(listReadyTasks(snapshot).map((record) => record.task.id)).toEqual([
      blindReviewWithFailedDependency.id,
      readyWithDoneDependency.id,
    ])
  })
})
