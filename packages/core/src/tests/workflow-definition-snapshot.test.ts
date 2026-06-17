import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createId, type RunWorkflowProfileSnapshot } from '../types.js'
import { loadRenderedWorkflowProfile } from '../workflow-renderer.js'
import { WorkflowDefinitionResolver } from '../workflow-definition-resolver.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []
const cleanupPaths: string[] = []
const fallbackWorkflowPath = fileURLToPath(
  new URL('../../../../workflows/coding-guard.yaml', import.meta.url),
)
const templatePath = fileURLToPath(
  new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url),
)

afterEach(() => {
  for (const context of cleanup.splice(0)) context.db.close()
  for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

function createProfile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-workflow-profile-'))
  cleanupPaths.push(dir)
  const profileDir = join(dir, '.edictum')
  mkdirSync(profileDir)
  writeFileSync(join(dir, 'SNAPSHOT.md'), '# Snapshot\n')
  const path = join(profileDir, 'profile.yaml')
  writeFileSync(path, contents)
  return path
}

function createRun(
  context: ReturnType<typeof createRepoContext>,
  specId: string,
  agentId: string,
  runtimeWorkflowProfile: RunWorkflowProfileSnapshot,
) {
  const task = context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: specId as never,
    name: 'snapshot task',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: agentId as never,
    status: 'active',
    verification: ['pnpm test'],
  })
  return context.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: agentId as never,
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
    runtimeWorkflowProfile,
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
}

describe('WorkflowDefinitionResolver run snapshots', () => {
  it('uses a persisted rendered workflow snapshot when the profile file is gone', () => {
    const context = createRepoContext()
    cleanup.push(context)
    const profilePath = createProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: deleted-profile
context:
  required_files: [SNAPSHOT.md]
verify:
  commands: ['pnpm deleted']
push: {}
`)
    const rendered = loadRenderedWorkflowProfile(templatePath, profilePath)
    rmSync(profilePath, { force: true })
    const { factory, builder } = seedBase(context)
    const project = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum-deleted-profile',
      repos: ['ductum'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const spec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'P2-deleted',
      status: 'approved',
      document: '# P2 deleted',
    })
    const run = createRun(context, spec.id, builder.id, {
      id: createId<'ConfigResourceId'>(),
      name: 'runtime-deleted',
      projectId: project.id,
      path: profilePath,
      renderedWorkflow: rendered.renderedWorkflow,
      setupCommands: [],
      verifyCommands: rendered.profile.verify.commands,
    })
    const resolver = new WorkflowDefinitionResolver({
      fallbackWorkflowPath,
      templateWorkflowPath: templatePath,
      runRepo: context.runRepo,
      taskRepo: context.taskRepo,
      specRepo: context.specRepo,
      projectRepo: context.projectRepo,
    })

    resolver.initialize()

    expect(
      resolver.getForRun(run.id).stages.find((stage) => stage.id === 'ship')?.checks[0]?.commandMatches,
    ).toContain('pnpm\\s+deleted')
  })

  it('rejects path-only run snapshots instead of re-reading mutable profile files', () => {
    const context = createRepoContext()
    cleanup.push(context)
    const profilePath = createProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: mutable-profile
context:
  required_files: [SNAPSHOT.md]
verify:
  commands: ['pnpm mutable']
push: {}
`)
    const { factory, builder } = seedBase(context)
    const project = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum-path-only-profile',
      repos: ['ductum'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const spec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'P2-path-only',
      status: 'approved',
      document: '# P2 path only',
    })
    const run = createRun(context, spec.id, builder.id, {
      id: createId<'ConfigResourceId'>(),
      name: 'runtime-path-only',
      projectId: project.id,
      path: profilePath,
    })
    const resolver = new WorkflowDefinitionResolver({
      fallbackWorkflowPath,
      templateWorkflowPath: templatePath,
      runRepo: context.runRepo,
      taskRepo: context.taskRepo,
      specRepo: context.specRepo,
      projectRepo: context.projectRepo,
    })

    resolver.initialize()

    expect(() => resolver.getForRun(run.id)).toThrow('missing materialized renderedWorkflow')
  })
})
