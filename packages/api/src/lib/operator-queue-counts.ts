import type { Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { openWorkflowFollowupForRun } from './run-workflow-followup.js'

export interface OperatorQueueRunCounts {
  approvalsWaiting: number
  activeRuns: number
}

/**
 * Explicit count API for operator summary queue counts.
 *
 * This intentionally uses an unbounded run scan because the current leaf-run
 * and workflow-follow-up semantics live in TypeScript helpers. Callers must
 * not replace this with RunRepo.listAll()'s default-limited result.
 */
export function countOperatorQueueRuns(context: ApiContext): OperatorQueueRunCounts {
  const runs = context.repos.runs.listAll({ limit: null })
  const leaves = toLeafRuns(runs)
    .filter(isOpenRun)
    .filter((run) => openWorkflowFollowupForRun(context.repos.tasks, run) == null)
  const approvalsWaiting = leaves.filter(isAwaitingApproval).length
  return { approvalsWaiting, activeRuns: leaves.length - approvalsWaiting }
}

function toLeafRuns(runs: Run[]): Run[] {
  const childrenByParent = new Map<string, Run[]>()
  for (const run of runs) {
    if (run.parentRunId == null) continue
    const children = childrenByParent.get(run.parentRunId) ?? []
    children.push(run)
    childrenByParent.set(run.parentRunId, children)
  }

  const hasOpenDescendant = (run: Run) => {
    const stack = [...(childrenByParent.get(run.id) ?? [])]
    while (stack.length > 0) {
      const child = stack.pop()!
      if (isOpenRun(child)) return true
      stack.push(...(childrenByParent.get(child.id) ?? []))
    }
    return false
  }

  return runs.filter((run) => !hasOpenDescendant(run))
}

function isOpenRun(run: Run): boolean {
  return run.stage !== 'done' && run.terminalState == null
}

function isAwaitingApproval(run: Run): boolean {
  return run.stage === 'ship' && run.pendingApproval
}
