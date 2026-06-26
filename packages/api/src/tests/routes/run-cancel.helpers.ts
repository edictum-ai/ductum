import { createId, type Run } from '@ductum/core'

import type { TestFixture } from '../helpers.js'

export function seedCancelRun(
  fixture: TestFixture,
  input: {
    taskId: Run['taskId']
    agentId: Run['agentId']
    overrides?: Partial<Run>
  },
): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: input.taskId,
    agentId: input.agentId,
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-05-03T10:00:00.000Z',
    heartbeatTimeoutSeconds: 120,
    ...input.overrides,
  })
}
