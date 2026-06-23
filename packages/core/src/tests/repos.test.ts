import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '../types.js'
import { createIds, createRepoContext, seedBase } from './helpers.js'
let context: ReturnType<typeof createRepoContext> | undefined
afterEach(() => {
  context?.db.close()
  context = undefined
})
describe('repository layer', () => {
  it('creates URL-safe 12-char IDs', () => {
    const id = createId<'FactoryId'>()
    expect(id).toHaveLength(12)
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })
  it('supports CRUD and JSON round-trips across repos', () => {
    context = createRepoContext()
    const ids = createIds()
    const { factory, project, builder, reviewer, spec } = seedBase(context)

    expect(context.factoryRepo.get()?.config.defaultMergeMode).toBe('human')
    expect(context.factoryRepo.update(factory.id, { config: { heartbeatTimeoutSeconds: 60, defaultMergeMode: 'auto' } }).config).toEqual({
      heartbeatTimeoutSeconds: 60,
      defaultMergeMode: 'auto',
    })

    const updatedProject = context.projectRepo.update(project.id, {
      name: 'ductum',
      repos: ['ductum-ai/ductum', 'edictum-ai/edictum-ts'],
      config: { mergeMode: 'human', workflowPath: 'workflows/custom.yaml' },
    })
    expect(context.projectRepo.getByName('ductum')?.repos).toEqual(updatedProject.repos)
    expect(updatedProject.config.workflowPath).toBe('workflows/custom.yaml')
    expect(context.projectAgentRepo.getByRole(project.id, 'reviewer')).toHaveLength(1)
    const target = context.targetRepo.create({
      id: ids.targetId,
      projectId: project.id,
      name: 'ductum',
      spec: {
        source: { type: 'local', localPath: '/Users/acartagena/project/ductum' },
        branch: { base: 'main', prefix: 'feat/' },
        workflowRef: '.edictum/workflow-profile.yaml',
      },
    })
    expect(context.targetRepo.getByName(project.id, 'ductum')?.spec.source.localPath).toBe('/Users/acartagena/project/ductum')
    expect(context.targetRepo.update(target.id, { spec: { source: { type: 'github', repo: 'acartag7/ductum' } } }).spec.source.repo).toBe('acartag7/ductum')
    const workflow = context.configResourceRepo.create({
      id: ids.configResourceId,
      kind: 'WorkflowProfile',
      projectId: project.id,
      name: 'coding-guard',
      spec: { path: '.edictum/workflow-profile.yaml', description: 'Default coding workflow' },
    })
    expect(context.configResourceRepo.getByName('WorkflowProfile', 'coding-guard', project.id)?.id).toBe(workflow.id)
    expect(context.configResourceRepo.upsert('Model', 'gpt-54', { provider: 'openai', modelId: 'gpt-5.4' }).name).toBe('gpt-54')

    const updatedAgent = context.agentRepo.update(builder.id, {
      model: 'claude-sonnet-4.5',
      resourceRefs: { modelRef: 'sonnet-45', sandboxRef: 'builder-host' },
      capabilities: ['build', 'fix'],
      spawnConfig: { workingDir: '/tmp/other', env: { CI: '1' } },
    })
    expect(updatedAgent.capabilities).toEqual(['build', 'fix'])
    expect(updatedAgent.resourceRefs).toMatchObject({ modelRef: 'sonnet-45', sandboxRef: 'builder-host' })
    expect(updatedAgent.spawnConfig).toEqual({ workingDir: '/tmp/other', env: { CI: '1' } })

    const spec2 = context.specRepo.create({
      id: ids.specId2,
      projectId: project.id,
      name: 'P2',
      status: 'draft',
      strategy: 'best_of_n',
      document: '# P2',
    })
    expect(spec.strategy).toBe('normal')
    expect(spec2.strategy).toBe('best_of_n')
    context.specDependencyRepo.add({ specId: spec2.id, dependsOnId: spec.id, kind: 'hard' })
    expect(context.specDependencyRepo.list(spec2.id)).toEqual([{ specId: spec2.id, dependsOnId: spec.id, kind: 'hard' }])
    expect(context.specRepo.updateStatus(spec.id, 'implementing').status).toBe('implementing')

    const task = context.taskRepo.create({
      id: ids.taskId,
      specId: spec.id,
      targetId: target.id,
      name: 'P1-CORE-TYPES',
      prompt: 'implement',
      repos: ['packages/core'],
      assignedAgentId: null,
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
      status: 'ready',
      verification: ['pnpm test'],
    })
    expect(task.targetId).toBe(target.id)
    expect(task.strategyRole).toBe('candidate')
    expect(task.strategyGroup).toBe('bon-1')
    const task2 = context.taskRepo.create({
      id: ids.taskId2,
      specId: spec.id,
      name: 'P2-STATE-MACHINE',
      prompt: 'state',
      repos: ['packages/core'],
      assignedAgentId: reviewer.id,
      status: 'pending',
      verification: ['pnpm test'],
    })
    expect(task2.strategyRole).toBe('normal')
    expect(task2.strategyGroup).toBeNull()
    context.taskDependencyRepo.add({ taskId: task2.id, dependsOnId: task.id })
    expect(context.taskRepo.assignAgent(task.id, builder.id).assignedAgentId).toBe(builder.id)
    expect(context.taskRepo.updateStatus(task2.id, 'blocked').status).toBe('blocked')

    const run = context.runRepo.create({
      id: ids.runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'understand',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-1',
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
      lastHeartbeat: '2026-04-04T10:00:00Z',
      heartbeatTimeoutSeconds: 120,
    })
    expect(() => context!.runRepo.create({
      ...run,
      id: ids.runId2,
      sessionId: 'session-2',
      lastHeartbeat: '2026-04-04T10:01:00Z',
    })).toThrow(/already has an active run/)
    expect(context.runRepo.create({
      ...run,
      id: ids.runId2,
      parentRunId: run.id,
      sessionId: 'session-2',
      lastHeartbeat: '2026-04-04T10:01:00Z',
    }).parentRunId).toBe(run.id)
    const mapping = context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: run.id,
      harness: 'claude-agent-sdk',
    })
    expect(mapping.controlToken).toHaveLength(64)
    expect(context.sessionRunMappingRepo.updateSessionId('session-1', 'session-1b', 'harness-session-1')).toMatchObject({
      sessionId: 'session-1b',
      runId: run.id,
      harnessSessionId: 'harness-session-1',
    })
    expect(context.sessionRunMappingRepo.get('session-1')).toBeNull()
    expect(context.sessionRunMappingRepo.get('session-1b')?.runId).toBe(run.id)
    expect(context.runRepo.getBySessionId('session-1b')?.id).toBe(run.id)
    expect(context.runRepo.updateGitArtifacts(run.id, { branch: 'feat/p1', commitSha: 'abc123', prNumber: 42, prUrl: 'https://example.test/pr/42' }).prNumber).toBe(42)
    expect(context.runRepo.updateLatchStatus(run.id, 'ciStatus', 'pending').ciStatus).toBe('pending')
    expect(context.runRepo.updateHeartbeat(run.id).lastHeartbeat).toMatch(/T/)
    expect(context.runRepo.updateTokens(run.id, 100, 40, 1.25).costUsd).toBe(1.25)
    expect(context.runRepo.updateFailure(run.id, 'ci failed', false).recoverable).toBe(false)
    expect(context.runRepo.updateStage(run.id, 'implement', 'reset').stage).toBe('implement')

    const transition = context.runStageHistoryRepo.add({
      runId: run.id,
      fromStage: 'understand',
      toStage: 'implement',
      reason: 'started',
    })
    expect(context.runStageHistoryRepo.list(run.id)).toEqual([transition])

    const evidence = context.evidenceRepo.create({
      id: ids.evidenceId,
      runId: run.id,
      type: 'test',
      payload: { passed: true, files: ['repos.test.ts'] },
    })
    expect(context.evidenceRepo.list(run.id)[0]?.payload).toEqual(evidence.payload)

    const evaluation = context.gateEvaluationRepo.create({
      runId: run.id,
      gateType: 'gate_check',
      target: 'pre-push-review',
      result: 'allowed',
      reason: null,
      observed: false,
    })
    expect(context.gateEvaluationRepo.list(run.id)[0]?.id).toBe(evaluation.id)
    expect(context.gateEvaluationRepo.list(run.id)[0]?.observed).toBe(false)

    const decision = context.decisionRepo.create({
      id: ids.decisionId,
      specId: spec.id,
      taskId: task.id,
      runId: run.id,
      decision: 'Use SQLite',
      context: 'Local-first',
      alternatives: ['Postgres'],
      decidedBy: 'codex',
      supersedesId: null,
    })
    expect(context.decisionRepo.list({ runId: run.id })[0]?.alternatives).toEqual(decision.alternatives)

    context.specDependencyRepo.remove(spec2.id, spec.id)
    context.taskDependencyRepo.remove(task2.id, task.id)
    context.projectAgentRepo.unassign(project.id, reviewer.id)
    context.targetRepo.delete(target.id)
    context.configResourceRepo.delete(workflow.id)
    context.sessionRunMappingRepo.delete('session-1')
    context.taskRepo.delete(task2.id)
    context.agentRepo.delete(reviewer.id)
    context.specRepo.delete(spec2.id)

    expect(context.sessionRunMappingRepo.get('session-1')).toBeNull()
    expect(context.targetRepo.get(target.id)).toBeNull()
    expect(context.configResourceRepo.get(workflow.id)).toBeNull()
    expect(context.agentRepo.get(reviewer.id)).toBeNull()
    expect(context.taskRepo.get(task2.id)).toBeNull()
    expect(context.specRepo.get(spec2.id)).toBeNull()
  })

  it('returns only ready tasks with completed dependencies', () => {
    context = createRepoContext()
    const ids = createIds()
    const { project, builder, spec } = seedBase(context)

    const doneTask = context.taskRepo.create({
      id: ids.taskId,
      specId: spec.id,
      name: 'done',
      prompt: 'done',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      status: 'done',
      verification: [],
    })
    const readyTask = context.taskRepo.create({
      id: ids.taskId2,
      specId: spec.id,
      name: 'ready',
      prompt: 'ready',
      repos: ['packages/core'],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })
    const activeReadyTask = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'active-ready',
      prompt: 'active-ready',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: [],
    })
    const blockedDependency = context.taskRepo.create({
      id: ids.taskId3,
      specId: spec.id,
      name: 'blocked-dep',
      prompt: 'blocked',
      repos: ['packages/core'],
      assignedAgentId: null,
      status: 'pending',
      verification: [],
    })
    const notReadyTask = context.taskRepo.create({
      id: ids.taskId4,
      specId: spec.id,
      name: 'not-ready',
      prompt: 'not-ready',
      repos: ['packages/core'],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })
    const draftSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'draft-spec',
      status: 'draft',
      document: '# Draft',
    })
    context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: draftSpec.id,
      name: 'draft-ready',
      prompt: 'draft-ready',
      repos: ['packages/core'],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })

    context.taskDependencyRepo.add({ taskId: readyTask.id, dependsOnId: doneTask.id })
    context.taskDependencyRepo.add({ taskId: notReadyTask.id, dependsOnId: blockedDependency.id })
    context.runRepo.create({
      id: ids.runId,
      taskId: activeReadyTask.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'understand',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'active-ready-session',
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
      lastHeartbeat: '2026-04-04T10:00:00Z',
      heartbeatTimeoutSeconds: 120,
    })

    expect(context.taskRepo.getReady(project.id, 'builder').map((task) => task.id)).toEqual([readyTask.id])
  })

  it('keeps blind-review tasks dispatchable after candidate failures', () => {
    context = createRepoContext()
    const ids = createIds()
    const { project, builder, reviewer } = seedBase(context)
    const spec = context.specRepo.create({
      id: ids.specId2,
      projectId: project.id,
      name: 'Best of N',
      status: 'approved',
      strategy: 'best_of_n',
      document: '# Best of N',
    })
    const passedCandidate = context.taskRepo.create({
      id: ids.taskId,
      specId: spec.id,
      name: 'candidate-passed',
      prompt: 'build',
      repos: [],
      assignedAgentId: builder.id,
      status: 'done',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
      verification: [],
    })
    const failedCandidate = context.taskRepo.create({
      id: ids.taskId2,
      specId: spec.id,
      name: 'candidate-failed',
      prompt: 'build',
      repos: [],
      assignedAgentId: builder.id,
      status: 'failed',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
      verification: [],
    })
    const review = context.taskRepo.create({
      id: ids.taskId3,
      specId: spec.id,
      name: 'blind-review',
      prompt: 'review',
      repos: [],
      assignedAgentId: reviewer.id,
      requiredRole: 'reviewer',
      status: 'blocked',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
      verification: [],
    })
    const normal = context.taskRepo.create({
      id: ids.taskId4,
      specId: spec.id,
      name: 'normal-dependent',
      prompt: 'normal',
      repos: [],
      assignedAgentId: reviewer.id,
      requiredRole: 'reviewer',
      status: 'ready',
      verification: [],
    })
    context.taskDependencyRepo.add({ taskId: review.id, dependsOnId: passedCandidate.id })
    context.taskDependencyRepo.add({ taskId: review.id, dependsOnId: failedCandidate.id })
    context.taskDependencyRepo.add({ taskId: normal.id, dependsOnId: failedCandidate.id })

    expect(context.taskRepo.getReady(project.id, 'reviewer').map((task) => task.id)).toContain(review.id)
    expect(context.taskRepo.getReady(project.id, 'reviewer').map((task) => task.id)).not.toContain(normal.id)
  })

  it('cascades project deletion to specs and tasks', () => {
    context = createRepoContext()
    const ids = createIds()
    const { project, spec } = seedBase(context)

    const task = context.taskRepo.create({
      id: ids.taskId,
      specId: spec.id,
      name: 'task',
      prompt: 'task',
      repos: ['packages/core'],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })
    context.projectRepo.delete(project.id)

    expect(context.specRepo.get(spec.id)).toBeNull()
    expect(context.taskRepo.get(task.id)).toBeNull()
    expect(context.projectAgentRepo.list(project.id)).toEqual([])
  })

  it('finds stalled runs and resolves session mappings', () => {
    context = createRepoContext()
    const ids = createIds()
    const { builder, spec } = seedBase(context)

    const task = context.taskRepo.create({
      id: ids.taskId,
      specId: spec.id,
      name: 'task',
      prompt: 'task',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const otherTask = context.taskRepo.create({
      id: ids.taskId2,
      specId: spec.id,
      name: 'other-task',
      prompt: 'other-task',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })

    const staleRun = context.runRepo.create({
      id: ids.runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'stale-session',
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
      lastHeartbeat: '2026-04-04T09:00:00Z',
      heartbeatTimeoutSeconds: 120,
    })
    context.sessionRunMappingRepo.create({ sessionId: 'stale-session', runId: staleRun.id, harness: 'claude-agent-sdk' })
    context.runRepo.create({
      id: ids.runId2,
      taskId: otherTask.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'fresh-session',
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
      lastHeartbeat: '2026-04-04T11:59:30Z',
      heartbeatTimeoutSeconds: 120,
    })

    expect(context.runRepo.getStalled('2026-04-04T10:00:00Z').map((run) => run.id)).toEqual([staleRun.id])
    expect(context.runRepo.getBySessionId('stale-session')?.id).toBe(staleRun.id)
    expect(context.sessionRunMappingRepo.getByRunId(staleRun.id)?.sessionId).toBe('stale-session')
  })
})
