import type { Run, RunId } from './types.js'

export type ApprovalLineageRun = Pick<
  Run,
  'id' | 'parentRunId' | 'stage' | 'terminalState' | 'pendingApproval'
>

export function isOpenLineageRun(run: ApprovalLineageRun): boolean {
  return run.terminalState == null && run.stage !== 'done'
}

export function listOpenDescendantRuns<T extends ApprovalLineageRun>(
  runs: readonly T[],
  runId: RunId | string,
): T[] {
  const childrenByParent = new Map<string, T[]>()
  for (const run of runs) {
    if (run.parentRunId == null) continue
    const children = childrenByParent.get(run.parentRunId) ?? []
    children.push(run)
    childrenByParent.set(run.parentRunId, children)
  }

  const open: T[] = []
  const stack = [...(childrenByParent.get(runId) ?? [])]
  while (stack.length > 0) {
    const child = stack.pop()!
    if (isOpenLineageRun(child)) open.push(child)
    stack.push(...(childrenByParent.get(child.id) ?? []))
  }
  return open
}

export function hasOpenDescendantRun(
  runs: readonly ApprovalLineageRun[],
  runId: RunId | string,
): boolean {
  return listOpenDescendantRuns(runs, runId).length > 0
}

export function isActionableApprovalRun<T extends ApprovalLineageRun>(
  run: T,
  runs: readonly ApprovalLineageRun[],
): boolean {
  return run.stage === 'ship'
    && run.pendingApproval
    && run.terminalState == null
    && !hasOpenDescendantRun(runs, run.id)
}
