import type { Run, RunId } from '@ductum/core'

import type { ApiContext } from './deps.js'

export function listBlockingApprovalDescendants(
  context: ApiContext,
  runId: RunId,
): Run[] {
  const runs = context.repos.runs.listAll({ limit: 10_000 })
  const childrenByParent = new Map<string, Run[]>()
  for (const run of runs) {
    if (run.parentRunId == null) continue
    const children = childrenByParent.get(run.parentRunId) ?? []
    children.push(run)
    childrenByParent.set(run.parentRunId, children)
  }

  const blockers: Run[] = []
  const stack = [...(childrenByParent.get(runId) ?? [])]
  while (stack.length > 0) {
    const child = stack.pop()!
    if (isBlockingApprovalDescendant(context, child)) blockers.push(child)
    stack.push(...(childrenByParent.get(child.id) ?? []))
  }
  return blockers
}

function isBlockingApprovalDescendant(context: ApiContext, run: Run): boolean {
  return isOpenLineageRun(run) && !isIgnorableGhostDescendant(context, run)
}

function isOpenLineageRun(run: Pick<Run, 'stage' | 'terminalState'>): boolean {
  return run.terminalState == null && run.stage !== 'done'
}

function isIgnorableGhostDescendant(context: ApiContext, run: Run): boolean {
  if (run.parentRunId == null) return false
  if (run.stage !== 'understand' || run.pendingApproval) return false
  if (run.sessionId != null) return false
  if ((run.worktreePaths?.length ?? 0) > 0) return false
  if (context.repos.evidence.list(run.id).length > 0) return false
  if (context.repos.runHistory.list(run.id).length > 0) return false
  if (context.repos.runUpdates.list(run.id).length > 0) return false
  return true
}
