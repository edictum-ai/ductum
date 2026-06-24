import { describe, expect, it } from 'vitest'

import { buildAttemptSnapshot } from '../attempt-snapshot.js'
import { resolveAgentRuntimeDetails } from '../agent-runtime-resolution.js'
import { createId, type Agent } from '../types.js'
import { createRepoContext, seedBase } from './helpers.js'

describe('Attempt snapshot settings stability', () => {
  it('keeps active Attempt snapshots stable after Agent, Model, and Harness edits', () => {
    const context = createRepoContext()
    try {
      const { project, builder } = seedBase(context)
      const spec = context.specRepo.create({
        id: createId<'SpecId'>(),
        projectId: project.id,
        name: 'Issue intake',
        status: 'approved',
        document: '# Issue intake',
        source: {
          kind: 'github-issue',
          provider: 'github',
          repoOwner: 'edictum-ai',
          repoName: 'ductum',
          issueNumber: 12,
          issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
          title: 'core: intake',
          labels: ['needs-triage'],
          importedAt: '2026-06-23T12:00:00.000Z',
          formId: 'ductum-work-item',
          parsed: {
            workType: 'feature',
            priority: 'P1 - blocks unattended/prod readiness',
            area: 'core',
            blockers: [],
            objective: 'Keep source provenance in the attempt snapshot.',
            evidence: ['packages/core/src/tests/attempt-snapshot-settings-stability.test.ts'],
            requirements: ['Must keep GitHub source metadata immutable'],
            outOfScope: ['Do not merge'],
            acceptanceCriteria: ['Attempt snapshot contains source'],
            verificationCommands: ['pnpm test'],
            safetyNotes: ['No destructive commands.'],
          },
        },
      })
      const model = context.configResourceRepo.create({
        id: createId<'ConfigResourceId'>(),
        kind: 'Model',
        projectId: null,
        name: 'gpt-54',
        spec: { provider: 'openai', modelId: 'gpt-5.4' },
      })
      const harness = context.configResourceRepo.create({
        id: createId<'ConfigResourceId'>(),
        kind: 'Harness',
        projectId: null,
        name: 'codex-runtime',
        spec: { type: 'codex-sdk' },
      })
      const agent = context.agentRepo.update(builder.id, {
        model: 'legacy-model',
        harness: 'claude-agent-sdk',
        resourceRefs: { modelRef: model.id, harnessRef: harness.id },
      })
      const task = context.taskRepo.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: 'Snapshot stability',
        prompt: 'implement',
        repos: ['packages/core'],
        source: spec.source,
        assignedAgentId: agent.id,
        status: 'active',
        verification: ['pnpm test'],
      })
      const runtime = resolveAgentRuntimeDetails(agent, project.id, context.configResourceRepo)
      const run = context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: agent.id,
        parentRunId: null,
        stage: 'understand',
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
        runtimeModel: runtime.agent.model,
        runtimeHarness: runtime.agent.harness,
        attemptSnapshot: buildAttemptSnapshot({
          task, spec, project, agent: agent as Agent, runtime, workflow: null,
          capturedAt: '2026-06-11T12:00:00.000Z',
        }),
        ciStatus: null,
        reviewStatus: null,
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: null,
        heartbeatTimeoutSeconds: 120,
      })

      context.agentRepo.update(agent.id, { model: 'claude-sonnet-4-6', harness: 'claude-agent-sdk' })
      context.configResourceRepo.update(model.id, { name: 'renamed-model', spec: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' } })
      context.configResourceRepo.update(harness.id, { name: 'renamed-harness', spec: { type: 'claude-agent-sdk' } })

      const snapshot = context.runRepo.get(run.id)?.attemptSnapshot
      expect(snapshot?.spec.source).toMatchObject({ issueNumber: 12 })
      expect(snapshot?.task.source).toMatchObject({ issueNumber: 12 })
      expect(snapshot?.provider.providerId).toBe('openai')
      expect(snapshot?.model).toMatchObject({
        modelId: 'gpt-54',
        providerModelId: 'gpt-5.4',
        resourceId: model.id,
        resourceName: 'gpt-54',
      })
      expect(snapshot?.harness).toMatchObject({
        harnessId: 'codex-runtime',
        adapterKey: 'codex-sdk',
        resourceId: harness.id,
        resourceName: 'codex-runtime',
      })
      expect(context.runRepo.get(run.id)).toMatchObject({ runtimeModel: 'gpt-5.4', runtimeHarness: 'codex-sdk' })
    } finally {
      context.db.close()
    }
  })
})
