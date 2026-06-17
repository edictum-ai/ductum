import type { Run, RunId } from '@ductum/core'

import type { ApiContext } from './deps.js'

export function collectOpenAncestorRuns(context: ApiContext, run: Run): Run[] {
  const ancestors: Run[] = []
  let cursor: Run | null = run
  while (cursor.parentRunId != null) {
    const parent = context.repos.runs.get(cursor.parentRunId)
    if (parent == null) break
    if (parent.stage !== 'done' && parent.terminalState == null) ancestors.push(parent)
    cursor = parent
  }
  return ancestors
}

export function collectOpenDescendantIdsByRun(runs: Run[]): Map<RunId, Set<RunId>> {
  const childrenByParent = new Map<RunId, Run[]>()
  for (const run of runs) {
    if (run.parentRunId == null) continue
    const children = childrenByParent.get(run.parentRunId) ?? []
    children.push(run)
    childrenByParent.set(run.parentRunId, children)
  }

  const cache = new Map<RunId, Set<RunId>>()
  const visit = (runId: RunId): Set<RunId> => {
    const cached = cache.get(runId)
    if (cached != null) return cached

    const descendants = new Set<RunId>()
    for (const child of childrenByParent.get(runId) ?? []) {
      if (child.stage !== 'done' && child.terminalState == null) descendants.add(child.id)
      for (const nested of visit(child.id)) descendants.add(nested)
    }
    cache.set(runId, descendants)
    return descendants
  }

  for (const run of runs) visit(run.id)
  return cache
}
