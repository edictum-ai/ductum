import { createId } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { failGitHubLifecycleBeforeApproval } from '../lib/github-lifecycle-failure.js'
import { createFixture, seedBase } from './helpers.js'

describe('GitHub lifecycle failure before approval', () => {
  it('terminalizes the run and keeps downstream work blocked', async () => {
    const fixture = await createFixture()
    try {
      const { spec, task, builder } = seedBase(fixture)
      fixture.repos.tasks.updateStatus(task.id, 'active')
      const dependent = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: 'Dependent Task',
        prompt: 'wait for ship',
        repos: ['packages/cli'],
        assignedAgentId: builder.id,
        status: 'blocked',
        verification: [],
      })
      fixture.repos.taskDependencies.add({
        taskId: dependent.id,
        dependsOnId: task.id,
      })
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'ship',
        terminalState: null,
        resetCount: 0,
        completedStages: ['understand', 'implement'],
        blockedReason: null,
        pendingApproval: false,
        sessionId: null,
        branch: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
        worktreePaths: ['/tmp/worktree'],
        ciStatus: null,
        reviewStatus: null,
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })

      const message = 'GitHub issue lifecycle failed before approval: Repository edictum-ai/ductum is missing GitHub App installation auth. Production writes fail closed; set repository.authRef to GitHub App credentials or explicitly set DUCTUM_GITHUB_DEV_WRITE_MODE for development only.'
      failGitHubLifecycleBeforeApproval({
        stateMachine: fixture.context.stateMachine,
        runUpdates: fixture.repos.runUpdates,
      }, run.id, message)
      fixture.context.dag.onRunComplete(run.id)

      expect(fixture.repos.runs.get(run.id)).toMatchObject({
        stage: 'ship',
        terminalState: 'failed',
        pendingApproval: false,
        blockedReason: null,
        failReason: message,
      })
      expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toBe(message)
      expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
      expect(fixture.repos.tasks.get(dependent.id)?.status).not.toBe('ready')
      expect(fixture.repos.tasks.get(dependent.id)?.status).not.toBe('done')
    } finally {
      fixture.close()
    }
  })
})
