import { afterEach, describe, expect, it } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { DuctumEventEmitter, type DuctumEvent } from '../events.js'
import { createId } from '../types.js'
import type { Agent, Project, Run, Spec, Task } from '../types.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []

afterEach(() => {
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
})

function createFixture() {
  const context = createRepoContext()
  cleanup.push(context)
  const { project, builder, reviewer, spec } = seedBase(context)
  const events: DuctumEvent[] = []
  const eventEmitter = new DuctumEventEmitter()
  eventEmitter.subscribe((event) => {
    events.push(event)
  })
  const evaluator = new DAGEvaluator(
    context.taskRepo,
    context.taskDependencyRepo,
    context.specRepo,
    context.specDependencyRepo,
    context.runRepo,
    eventEmitter,
  )

  return { context, project, builder, reviewer, spec, events, evaluator }
}

function createTask(
  fixture: ReturnType<typeof createFixture>,
  name: string,
  options: Partial<
    Pick<Task, 'status' | 'assignedAgentId' | 'requiredRole' | 'specId' | 'strategyRole' | 'strategyGroup'>
  > = {},
): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: options.specId ?? fixture.spec.id,
    name,
    prompt: `implement ${name}`,
    repos: ['packages/core'],
    assignedAgentId: options.assignedAgentId ?? null,
    requiredRole: options.requiredRole,
    strategyRole: options.strategyRole,
    strategyGroup: options.strategyGroup,
    status: options.status ?? 'pending',
    verification: ['pnpm test'],
  })
}
function dependOn(fixture: ReturnType<typeof createFixture>, task: Task, dependsOn: Task): void {
  fixture.context.taskDependencyRepo.add({ taskId: task.id, dependsOnId: dependsOn.id })
}
function createRun(
  fixture: ReturnType<typeof createFixture>,
  task: Task,
  agent: Agent,
  stage: Run['stage'],
  options?: { terminalState?: Run['terminalState'] },
): Run {
  return fixture.context.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: agent.id,
    parentRunId: null,
    stage,
    terminalState: options?.terminalState ?? null,
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
    failReason: options?.terminalState === 'failed' ? 'failed' : null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-04T10:00:00Z',
    heartbeatTimeoutSeconds: 120,
  })
}
function createSpec(
  fixture: ReturnType<typeof createFixture>,
  project: Project,
  name: string,
  status: Spec['status'] = 'approved',
  document = `# ${name}`,
  strategy: Spec['strategy'] = 'normal',
): Spec {
  return fixture.context.specRepo.create({
    id: createId<'SpecId'>(),
    projectId: project.id,
    name,
    status,
    strategy,
    document,
  })
}

describe('DAGEvaluator', () => {
  it('unblocks a linear task chain as dependencies complete', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A')
    const taskB = createTask(fixture, 'B')
    const taskC = createTask(fixture, 'C')
    dependOn(fixture, taskB, taskA)
    dependOn(fixture, taskC, taskB)
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskA.id])
    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('blocked')
    expect(fixture.context.taskRepo.get(taskC.id)?.status).toBe('blocked')
    fixture.context.taskRepo.updateStatus(taskA.id, 'done')
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskB.id])
    fixture.context.taskRepo.updateStatus(taskB.id, 'done')
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskC.id])
  })

  it('handles a diamond task DAG', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A')
    const taskB = createTask(fixture, 'B')
    const taskC = createTask(fixture, 'C')
    const taskD = createTask(fixture, 'D')
    dependOn(fixture, taskB, taskA)
    dependOn(fixture, taskC, taskA)
    dependOn(fixture, taskD, taskB)
    dependOn(fixture, taskD, taskC)
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskA.id])
    fixture.context.taskRepo.updateStatus(taskA.id, 'done')
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskB.id, taskC.id])
    fixture.context.taskRepo.updateStatus(taskB.id, 'done')
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([])
    expect(fixture.context.taskRepo.get(taskD.id)?.status).toBe('blocked')
    fixture.context.taskRepo.updateStatus(taskC.id, 'done')
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskD.id])
  })

  it('marks tasks with no dependencies ready immediately', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A')
    const taskB = createTask(fixture, 'B')
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([taskA.id, taskB.id])
    expect(fixture.context.taskRepo.get(taskA.id)?.status).toBe('ready')
    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('ready')
  })

  it('preserves an explicitly blocked task with no dependencies', () => {
    const fixture = createFixture()
    const blocked = createTask(fixture, 'operator-blocked', { status: 'blocked' })
    const pending = createTask(fixture, 'pending')

    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([pending.id])
    expect(fixture.context.taskRepo.get(blocked.id)?.status).toBe('blocked')
    expect(fixture.context.taskRepo.get(pending.id)?.status).toBe('ready')
  })

  it('propagates failed tasks through dependents', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A', { status: 'failed' })
    const taskB = createTask(fixture, 'B')
    const taskC = createTask(fixture, 'C')
    dependOn(fixture, taskB, taskA)
    dependOn(fixture, taskC, taskB)
    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([])
    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('failed')
    expect(fixture.context.taskRepo.get(taskC.id)?.status).toBe('failed')
  })

  it('lets bakeoff blind review run after candidates finish or fail', () => {
    const fixture = createFixture()
    const bakeoffSpec = createSpec(
      fixture,
      fixture.project,
      'model-race',
      'approved',
      'Compare candidate output.',
      'best_of_n',
    )
    const candidateA = createTask(fixture, 'candidate-codex', {
      specId: bakeoffSpec.id,
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
      status: 'done',
    })
    const candidateB = createTask(fixture, 'candidate-glm', {
      specId: bakeoffSpec.id,
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
      status: 'failed',
    })
    const review = createTask(fixture, 'blind-review', {
      specId: bakeoffSpec.id,
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    dependOn(fixture, review, candidateA)
    dependOn(fixture, review, candidateB)

    expect(fixture.evaluator.evaluateTaskDAG(bakeoffSpec.id)).toEqual([review.id])
    expect(fixture.context.taskRepo.get(review.id)?.status).toBe('ready')
  })

  it('does not use bakeoff text or task names as routing authority', () => {
    const fixture = createFixture()
    const normalSpec = createSpec(
      fixture,
      fixture.project,
      'bakeoff-looking-spec',
      'approved',
      'This document says bakeoff but has normal typed metadata.',
    )
    const failedCandidate = createTask(fixture, 'candidate-codex', {
      specId: normalSpec.id,
      status: 'failed',
    })
    const review = createTask(fixture, 'blind-review', {
      specId: normalSpec.id,
      requiredRole: 'reviewer',
    })
    dependOn(fixture, review, failedCandidate)

    expect(fixture.evaluator.evaluateTaskDAG(normalSpec.id)).toEqual([])
    expect(fixture.context.taskRepo.get(review.id)?.status).toBe('failed')
  })

  it('marks a task done when the latest run succeeds', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A', { status: 'active', assignedAgentId: fixture.builder.id })
    const taskB = createTask(fixture, 'B')
    dependOn(fixture, taskB, taskA)
    createRun(fixture, taskA, fixture.builder, 'implement', { terminalState: 'failed' })
    const latestRun = createRun(fixture, taskA, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(latestRun.id)
    expect(fixture.context.taskRepo.get(taskA.id)?.status).toBe('done')
    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('ready')
  })

  it('reconsiders dependency-failed tasks that never had their own attempt', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A', { status: 'active', assignedAgentId: fixture.builder.id })
    const taskB = createTask(fixture, 'B', { status: 'failed' })
    dependOn(fixture, taskB, taskA)

    const runA = createRun(fixture, taskA, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(runA.id)

    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('ready')
  })

  it('does not resurrect failed tasks that have their own failed attempt', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A', { status: 'active', assignedAgentId: fixture.builder.id })
    const taskB = createTask(fixture, 'B', { status: 'failed' })
    dependOn(fixture, taskB, taskA)
    createRun(fixture, taskB, fixture.builder, 'implement', { terminalState: 'failed' })

    const runA = createRun(fixture, taskA, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(runA.id)

    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('failed')
  })

  it('respects hard spec dependencies and ignores soft ones', () => {
    const fixture = createFixture()
    const specA = fixture.spec
    const specB = createSpec(fixture, fixture.project, 'P2')
    const specC = createSpec(fixture, fixture.project, 'P3')
    fixture.context.specDependencyRepo.add({ specId: specB.id, dependsOnId: specA.id, kind: 'hard' })
    fixture.context.specDependencyRepo.add({ specId: specC.id, dependsOnId: specA.id, kind: 'soft' })
    expect(fixture.evaluator.evaluateSpecDAG(fixture.project.id)).toEqual([specA.id, specC.id])
    fixture.context.specRepo.updateStatus(specA.id, 'done')
    expect(fixture.evaluator.evaluateSpecDAG(fixture.project.id)).toEqual([specB.id, specC.id])
  })

  it('marks a spec failed when all meaningful child tasks are terminal with a failure', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A', { status: 'done' })
    const taskB = createTask(fixture, 'review-A', { status: 'failed', requiredRole: 'reviewer' })

    expect(fixture.evaluator.evaluateTaskDAG(fixture.spec.id)).toEqual([])
    expect(fixture.context.specRepo.get(fixture.spec.id)?.status).toBe('failed')
    expect(fixture.events).toContainEqual({
      type: 'spec.status_changed',
      specId: fixture.spec.id,
      from: 'approved',
      to: 'failed',
    })
    expect(taskA.status).toBe('done')
    expect(taskB.status).toBe('failed')
  })

  it('marks a spec done and re-evaluates dependent specs when all tasks finish', () => {
    const fixture = createFixture()
    const dependentSpec = createSpec(fixture, fixture.project, 'P2')
    fixture.context.specDependencyRepo.add({ specId: dependentSpec.id, dependsOnId: fixture.spec.id, kind: 'hard' })
    const taskA = createTask(fixture, 'A', { status: 'active', assignedAgentId: fixture.builder.id })
    const taskB = createTask(fixture, 'B')
    dependOn(fixture, taskB, taskA)
    const runA = createRun(fixture, taskA, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(runA.id)
    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('ready')
    // Spec auto-transitions to 'implementing' when first task completes
    expect(fixture.context.specRepo.get(fixture.spec.id)?.status).toBe('implementing')
    fixture.context.taskRepo.updateStatus(taskB.id, 'active')
    const runB = createRun(fixture, taskB, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(runB.id)
    expect(fixture.context.taskRepo.get(taskB.id)?.status).toBe('done')
    expect(fixture.context.specRepo.get(fixture.spec.id)?.status).toBe('done')
    expect(fixture.evaluator.evaluateSpecDAG(fixture.project.id)).toContain(dependentSpec.id)
  })

  it('detects valid and cyclic task DAGs', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A')
    const taskB = createTask(fixture, 'B')
    const taskC = createTask(fixture, 'C')
    dependOn(fixture, taskB, taskA)
    dependOn(fixture, taskC, taskB)
    expect(fixture.evaluator.validateDAG(fixture.spec.id)).toEqual({ valid: true })
    fixture.context.taskDependencyRepo.add({ taskId: taskA.id, dependsOnId: taskC.id })
    const cycle = fixture.evaluator.validateDAG(fixture.spec.id)
    expect(cycle.valid).toBe(false)
    expect(cycle.cycle).toEqual(expect.arrayContaining([taskA.id, taskB.id, taskC.id]))
  })

  it('detects a direct two-node cycle', () => {
    const fixture = createFixture()
    const taskA = createTask(fixture, 'A')
    const taskB = createTask(fixture, 'B')
    dependOn(fixture, taskA, taskB)
    dependOn(fixture, taskB, taskA)
    const cycle = fixture.evaluator.validateDAG(fixture.spec.id)
    expect(cycle.valid).toBe(false)
    expect(cycle.cycle).toEqual(expect.arrayContaining([taskA.id, taskB.id]))
  })

  it('returns the highest-priority ready task with project and role filters', () => {
    const fixture = createFixture()
    const otherProject = fixture.context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: fixture.project.factoryId,
      name: 'other-project',
      repos: ['other/repo'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const otherSpec = createSpec(fixture, otherProject, 'Other')
    fixture.context.projectAgentRepo.assign({ projectId: otherProject.id, agentId: fixture.reviewer.id, role: 'reviewer' })
    const firstTask = createTask(fixture, 'first')
    const assignedReviewerTask = createTask(fixture, 'review', {
      assignedAgentId: fixture.reviewer.id,
    })
    createTask(fixture, 'later')
    const otherTask = createTask(fixture, 'other', { specId: otherSpec.id })
    fixture.evaluator.evaluateTaskDAG(fixture.spec.id)
    fixture.evaluator.evaluateTaskDAG(otherSpec.id)
    expect(fixture.evaluator.nextTask()?.id).toBe(firstTask.id)
    expect(fixture.evaluator.nextTask(fixture.project.id)?.id).toBe(firstTask.id)
    expect(fixture.evaluator.nextTask(otherProject.id)?.id).toBe(otherTask.id)
    expect(fixture.evaluator.nextTask(fixture.project.id, 'reviewer')?.id).toBe(assignedReviewerTask.id)
    expect(fixture.evaluator.nextTask(fixture.project.id, 'docs')).toBeNull()
  })

  it('matches required roles with builder fallback for unassigned tasks', () => {
    const fixture = createFixture()
    const reviewerTask = createTask(fixture, 'reviewer-task', { requiredRole: 'reviewer' })
    fixture.evaluator.evaluateTaskDAG(fixture.spec.id)
    expect(fixture.evaluator.nextTask(fixture.project.id, 'reviewer')?.id).toBe(reviewerTask.id)
    expect(fixture.evaluator.nextTask(fixture.project.id, 'builder')).toBeNull()

    const builderTask = createTask(fixture, 'builder-task', { requiredRole: null })
    fixture.evaluator.evaluateTaskDAG(fixture.spec.id)
    expect(fixture.evaluator.nextTask(fixture.project.id, 'builder')?.id).toBe(builderTask.id)
  })

  it('emits task and spec status change events for DAG transitions', () => {
    const fixture = createFixture()
    const dependentSpec = createSpec(fixture, fixture.project, 'P2')
    fixture.context.specDependencyRepo.add({ specId: dependentSpec.id, dependsOnId: fixture.spec.id, kind: 'hard' })
    const taskA = createTask(fixture, 'A', { status: 'active', assignedAgentId: fixture.builder.id })
    const taskB = createTask(fixture, 'B')
    dependOn(fixture, taskB, taskA)
    const runA = createRun(fixture, taskA, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(runA.id)
    fixture.context.taskRepo.updateStatus(taskB.id, 'active')
    const runB = createRun(fixture, taskB, fixture.builder, 'done')
    fixture.evaluator.onRunComplete(runB.id)
    expect(fixture.events).toEqual(
      expect.arrayContaining([
        { type: 'task.status_changed', taskId: taskA.id, from: 'active', to: 'done' },
        { type: 'task.status_changed', taskId: taskB.id, from: 'pending', to: 'ready' },
        { type: 'spec.status_changed', specId: fixture.spec.id, from: 'approved', to: 'implementing' },
        { type: 'task.status_changed', taskId: taskB.id, from: 'active', to: 'done' },
        { type: 'spec.status_changed', specId: fixture.spec.id, from: 'implementing', to: 'done' },
      ]),
    )
  })

  it('returns null when no ready tasks match', () => {
    const fixture = createFixture()
    createTask(fixture, 'A')
    expect(fixture.evaluator.nextTask()).toBeNull()
  })
})
