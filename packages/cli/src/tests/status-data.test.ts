import type { Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { findOpenWorkflowFollowup } from '../commands/status-data.js'
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
