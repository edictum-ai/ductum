import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

import { createId } from '../types.js'
import { WorkflowDefinitionResolver } from '../workflow-definition-resolver.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const contexts: RepoContext[] = []
const fallbackWorkflowPath = fileURLToPath(new URL('../../../../workflows/coding-guard.yaml', import.meta.url))
const templatePath = fileURLToPath(new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url))
const profilePath = fileURLToPath(new URL('../../../../.edictum/workflow-profile.yaml', import.meta.url))

afterEach(() => {
  for (const context of contexts.splice(0)) context.db.close()
})

describe('WorkflowDefinitionResolver project workflowProfileRef', () => {
  it('fails exactly when a legacy project workflowProfile name matches multiple records', () => {
    const context = createRepoContext()
    contexts.push(context)

    const { factory, builder } = seedBase(context)
    const project = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum-ambiguous',
      repos: ['ductum'],
      config: {
        mergeMode: 'auto',
        workflowPath: 'workflows/coding-guard.yaml',
        workflowProfile: 'shared-profile',
      },
    })
    context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'shared-profile',
      spec: { path: profilePath },
    })
    context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: project.id,
      name: 'shared-profile',
      spec: { path: profilePath },
    })
    const spec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'P2-ambiguous',
      status: 'approved',
      document: '# P2 ambiguous',
    })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'ambiguous workflow',
      prompt: 'implement',
      repos: ['ductum'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: ['pnpm test'],
    })
    const run = context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
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
    const resolver = new WorkflowDefinitionResolver({
      fallbackWorkflowPath,
      templateWorkflowPath: templatePath,
      runRepo: context.runRepo,
      taskRepo: context.taskRepo,
      specRepo: context.specRepo,
      projectRepo: context.projectRepo,
      configResourceRepo: context.configResourceRepo,
      repositoryRepo: context.repositoryRepo,
    })

    resolver.initialize()

    expect(() => resolver.getForRun(run.id))
      .toThrow('Project ductum-ambiguous workflowProfile "shared-profile" matches multiple WorkflowProfile records')
  })
})
