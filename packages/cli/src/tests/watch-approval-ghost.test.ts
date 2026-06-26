import { describe, expect, it } from 'vitest'

import { listActiveRuns, listWaitingApprovalRuns } from '../commands/status-data.js'
import type { WorkspaceSnapshot } from '../types.js'
import { activeRun, activeTask, agent, project, spec } from './helpers.js'

describe('watch approval ghost suppression', () => {
  it('keeps the root approval row visible and hides empty lifecycle children', () => {
    const rootRun = {
      ...activeRun,
      id: 'run-root' as typeof activeRun.id,
      stage: 'ship' as const,
      pendingApproval: true,
      branch: 'feature/x',
      commitSha: 'abc123',
      prNumber: 42,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
      sessionId: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    }
    const ghostChild = {
      ...activeRun,
      id: 'run-ghost' as typeof activeRun.id,
      parentRunId: rootRun.id,
      stage: 'understand' as const,
      pendingApproval: false,
      sessionId: null,
      branch: rootRun.branch,
      commitSha: rootRun.commitSha,
      prNumber: rootRun.prNumber,
      prUrl: rootRun.prUrl,
      worktreePaths: null,
      completedStages: [],
      blockedReason: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    }
    const snapshot: WorkspaceSnapshot = {
      projects: [project],
      repositories: [],
      projectAgents: [],
      agents: [agent],
      specs: [spec],
      tasks: [{ ...activeTask, status: 'active' }],
      taskDependencies: [],
      runs: [rootRun, ghostChild],
    }

    expect(listWaitingApprovalRuns(snapshot, new Date())).toEqual([
      expect.objectContaining({ run: expect.objectContaining({ id: rootRun.id }) }),
    ])
    expect(listActiveRuns(snapshot, new Date())).toEqual([])
  })
})
