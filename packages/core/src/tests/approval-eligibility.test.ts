import { describe, expect, it } from 'vitest'
import type { Run } from '../types.js'
import { isActionableApprovalRun, listOpenDescendantRuns } from '../approval-eligibility.js'

function run(id: string, parentRunId: string | null, stage: Run['stage'], pendingApproval = false): Pick<
  Run,
  'id' | 'parentRunId' | 'stage' | 'terminalState' | 'pendingApproval'
> {
  return {
    id: id as Run['id'],
    parentRunId: parentRunId as Run['id'] | null,
    stage,
    terminalState: null,
    pendingApproval,
  }
}

describe('approval eligibility', () => {
  it('blocks parent approvals while descendant work is still open', () => {
    const root = run('root', null, 'ship', true)
    const fix = run('fix', 'root', 'implement')
    const review = run('review', 'fix', 'ship', true)
    const runs = [root, fix, review]

    expect(listOpenDescendantRuns(runs, 'root').map((r) => r.id)).toEqual(['fix', 'review'])
    expect(isActionableApprovalRun(root, runs)).toBe(false)
    expect(isActionableApprovalRun(review, runs)).toBe(true)
  })
})
