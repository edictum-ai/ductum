import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createId,
  operatorAttemptFromRun,
  type Agent,
} from '../index.js'
import {
  createFixture,
  createTask,
  seedImplRun,
} from './dispatcher/shared.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Attempt facade', () => {
  it('captures runtime snapshot details and keeps them immutable after config edits', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'ductum-attempt-'))
    cleanup.push(repoPath)
    mkdirSync(join(repoPath, 'prompts'), { recursive: true })
    writeFileSync(join(repoPath, 'prompts', 'builder.md'), 'builder prompt\n')
    const fixture = createFixture({
      resolveRepoPath: (repo) => repo,
      validateWorkflowProfile: () => ({
        renderedWorkflow: 'workflow v1',
        setupCommands: ['pnpm install --frozen-lockfile'],
        verifyCommands: ['pnpm test'],
      }),
    })
    const model = fixture.context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'Model',
      projectId: null,
      name: 'claude-sonnet',
      spec: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    })
    const harness = fixture.context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'Harness',
      projectId: null,
      name: 'claude',
      spec: { type: 'claude-agent-sdk' },
    })
    const workflow = fixture.context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'guard',
      spec: { path: 'workflows/guard-v1.yaml', description: 'v1' },
    })
    fixture.context.agentRepo.update(fixture.builder.id, {
      resourceRefs: {
        modelRef: model.name,
        harnessRef: harness.name,
        workflowProfileRef: workflow.name,
        systemPromptRef: 'prompts/builder.md',
      },
    })
    const repository = fixture.context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: fixture.project.id,
      name: 'ductum',
      spec: { localPath: repoPath, defaultBranch: 'main', branchPrefix: 'feat/' },
    })
    const component = fixture.context.componentRepo.create({
      id: createId<'ComponentId'>() as never,
      repositoryId: repository.id,
      name: 'core',
      spec: { path: 'packages/core' },
    })
    const task = fixture.context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: fixture.spec.id,
      repositoryId: repository.id,
      componentId: component.id,
      name: 'P5',
      prompt: 'implement',
      repos: [repoPath],
      assignedAgentId: fixture.builder.id,
      status: 'ready',
      verification: ['pnpm test'],
    })

    const run = await fixture.dispatcher.manualDispatch(task.id, fixture.builder.id)
    const attempt = operatorAttemptFromRun(fixture.context.runRepo.get(run.id)!)
    const snapshot = attempt.snapshot.runtime

    expect(attempt.recordType).toBe('Attempt')
    expect(attempt.snapshot.completeness).toBe('full')
    expect(snapshot.agent?.name).toBe('mimi')
    expect(snapshot.agent?.systemPromptRef).toBe('prompts/builder.md')
    expect(snapshot.provider?.providerId).toBe('anthropic')
    expect(snapshot.model?.providerModelId).toBe('claude-sonnet-4-6')
    expect(snapshot.harness?.adapterKey).toBe('claude-agent-sdk')
    expect(snapshot.workflow?.path).toBe('workflows/guard-v1.yaml')
    expect(snapshot.repository?.id).toBe(repository.id)
    expect(snapshot.component?.id).toBe(component.id)
    expect(snapshot.execution?.workingDir).toBe(repoPath)

    fixture.context.agentRepo.update(fixture.builder.id, {
      model: 'gpt-5.4',
      harness: 'codex-sdk',
      resourceRefs: { modelRef: 'other', harnessRef: 'other', workflowProfileRef: 'other' },
    })
    fixture.context.configResourceRepo.update(model.id, { spec: { provider: 'openai', modelId: 'gpt-5.4' } })
    fixture.context.configResourceRepo.update(harness.id, { spec: { type: 'codex-sdk' } })
    fixture.context.configResourceRepo.update(workflow.id, { spec: { path: 'workflows/guard-v2.yaml' } })

    expect(operatorAttemptFromRun(fixture.context.runRepo.get(run.id)!).snapshot.runtime).toEqual(snapshot)
  })

  it('maps legacy Runs to partial legacy Attempts without invented snapshot fields', () => {
    const fixture = createFixture()
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id, status: 'active' })
    const run = fixture.context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: fixture.builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'feat/legacy',
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/legacy'],
      runtimeModel: 'claude-opus-4.6',
      runtimeHarness: 'claude-agent-sdk',
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

    const attempt = operatorAttemptFromRun(run)

    expect(attempt.snapshot).toMatchObject({ completeness: 'partial-legacy', legacy: true })
    expect(attempt.snapshot.runtime.model?.modelId).toBe('claude-opus-4.6')
    expect(attempt.snapshot.runtime.model?.providerModelId).toBeUndefined()
    expect(attempt.snapshot.missingFields).toContain('model.providerModelId')
    expect(attempt.snapshot.runtime.provider).toBeUndefined()
    expect(attempt.snapshot.runtime.repository).toBeUndefined()
    expect(attempt.snapshot.runtime.spec).toBeUndefined()
  })

  it('uses a new Attempt identity when work rotates to another Agent', async () => {
    const fixture = createFixture()
    const backup = fixture.context.agentRepo.create({
      id: createId<'AgentId'>(),
      name: 'backup',
      model: 'gpt-5.4',
      harness: 'vercel-ai',
      capabilities: ['build'],
      costTier: 10,
      spawnConfig: {},
    } satisfies Omit<Agent, 'createdAt'>)
    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: backup.id, role: 'builder' })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id, status: 'ready' })

    const first = await fixture.dispatcher.manualDispatch(task.id, fixture.builder.id)
    fixture.context.runRepo.updateTerminalState(first.id, 'failed')
    fixture.context.taskRepo.updateStatus(task.id, 'ready')
    fixture.context.taskRepo.assignAgent(task.id, backup.id)
    const second = await fixture.dispatcher.manualDispatch(task.id, backup.id)

    expect(second.id).not.toBe(first.id)
    expect(operatorAttemptFromRun(fixture.context.runRepo.get(first.id)!).agentId).toBe(fixture.builder.id)
    expect(operatorAttemptFromRun(fixture.context.runRepo.get(second.id)!).agentId).toBe(backup.id)
  })

  it('creates separate Attempt identities for fix and review work', async () => {
    const fixture = createFixture({ resolveRepoPath: () => '/tmp/repo' })
    const { run: implRun } = seedImplRun(fixture, 'Feature', { worktree: '/tmp/repo-worktree' })
    const fixTask = createTask(fixture, {
      name: 'fix-Feature-r1',
      assignedAgentId: fixture.builder.id,
      requiredRole: 'builder',
      status: 'ready',
    })
    const reviewTask = createTask(fixture, {
      name: 'review-Feature',
      assignedAgentId: fixture.reviewer.id,
      requiredRole: 'reviewer',
      status: 'ready',
    })

    const fixRun = await fixture.dispatcher.manualDispatch(fixTask.id, fixture.builder.id)
    const reviewRun = await fixture.dispatcher.manualDispatch(reviewTask.id, fixture.reviewer.id)

    expect(fixRun.id).not.toBe(implRun.id)
    expect(reviewRun.id).not.toBe(implRun.id)
    expect(operatorAttemptFromRun(fixRun).parentAttemptId).toBe(implRun.id)
    expect(operatorAttemptFromRun(reviewRun).parentAttemptId).toBe(fixRun.id)
    expect(operatorAttemptFromRun(fixRun).snapshot.runtime.execution?.workingDir).toBe('/tmp/repo-worktree')
    expect(operatorAttemptFromRun(fixRun).snapshot.runtime.execution?.worktreePaths).toEqual(['/tmp/repo-worktree'])
  })
})
