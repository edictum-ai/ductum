import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { createId, type RunWorkflowProfileSnapshot } from '../types.js'
import { WorkflowDefinitionResolver } from '../workflow-definition-resolver.js'
import { loadRenderedWorkflow, loadRenderedWorkflowProfile } from '../workflow-renderer.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []
const cleanupPaths: string[] = []
const fallbackWorkflowPath = fileURLToPath(
  new URL('../../../../workflows/coding-guard.yaml', import.meta.url),
)
const templatePath = fileURLToPath(
  new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url),
)
const profilePath = fileURLToPath(
  new URL('../../../../.edictum/workflow-profile.yaml', import.meta.url),
)

afterEach(() => {
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function createRun(
  context: ReturnType<typeof createRepoContext>,
  specId: string,
  agentId: string,
  runtimeWorkflowProfile?: RunWorkflowProfileSnapshot,
) {
  const task = context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: specId as never,
    name: `task-${specId}`,
    prompt: 'implement repo profiles',
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
    ...(runtimeWorkflowProfile == null ? {} : { runtimeWorkflowProfile }),
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

describe('WorkflowDefinitionResolver', () => {
  it('uses project-specific definitions and falls back to the static workflow', () => {
    const context = createRepoContext()
    cleanup.push(context)

    const { factory, project, builder, spec } = seedBase(context)
    const fallbackRun = createRun(context, spec.id, builder.id)
    const ductumProject = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum',
      repos: ['ductum'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const ductumSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: ductumProject.id,
      name: 'P2',
      status: 'approved',
      document: '# P2',
    })
    const profiledRun = createRun(context, ductumSpec.id, builder.id)
    const profiledDefinition = loadRenderedWorkflow(templatePath, profilePath)
    const resolver = new WorkflowDefinitionResolver({
      fallbackWorkflowPath,
      templateWorkflowPath: templatePath,
      workflowDefsByProjectName: new Map([['ductum', profiledDefinition]]),
      runRepo: context.runRepo,
      taskRepo: context.taskRepo,
      specRepo: context.specRepo,
      projectRepo: context.projectRepo,
    })

    resolver.initialize()

    const fallbackDefinition = resolver.getForRun(fallbackRun.id)
    const selectedProfileDefinition = resolver.getForRun(profiledRun.id)

    expect(project.name).toBe('edictum')
    expect(selectedProfileDefinition).toBe(profiledDefinition)
    // Priority 8: the "no git push in implement" check was deleted
    // from the fallback workflow because Priority 2's ductum.complete
    // terminator makes it unreachable. The sole remaining implement
    // check is the main/master branch protection at checks[0].
    expect(
      selectedProfileDefinition.stages.find((stage) => stage.id === 'implement')?.checks[0]
        ?.commandNotMatches,
    ).not.toContain('master')
    expect(
      fallbackDefinition.stages.find((stage) => stage.id === 'implement')?.checks[0]
        ?.commandNotMatches,
    ).toContain('master')
  })

  it('loads a rendered workflow from persisted project config without a preloaded env map', () => {
    const context = createRepoContext()
    cleanup.push(context)

    const { factory, builder } = seedBase(context)
    const ductumProject = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum-direct',
      repos: ['ductum'],
      config: {
        mergeMode: 'auto',
        workflowPath: 'workflows/coding-guard.yaml',
        workflowProfile: profilePath,
      },
    })
    const ductumSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: ductumProject.id,
      name: 'P2-direct',
      status: 'approved',
      document: '# P2 direct',
    })
    const profiledRun = createRun(context, ductumSpec.id, builder.id)
    const resolver = new WorkflowDefinitionResolver({
      fallbackWorkflowPath,
      templateWorkflowPath: templatePath,
      runRepo: context.runRepo,
      taskRepo: context.taskRepo,
      specRepo: context.specRepo,
      projectRepo: context.projectRepo,
    })

    resolver.initialize()

    const selectedDefinition = resolver.getForRun(profiledRun.id)
    // AGENTS.md is optional — should NOT appear in exit gates
    const readExitMessages = selectedDefinition.stages
      .find((stage) => stage.id === 'understand')
      ?.exit.map((gate) => gate.message) ?? []
    expect(readExitMessages).toContain('Read README.md before editing')
    expect(readExitMessages).toContain('Read CLAUDE.md before editing')
    expect(readExitMessages).not.toContain('Read AGENTS.md before editing')
    expect(
      selectedDefinition.stages.find((stage) => stage.id === 'ship')?.checks[0]?.commandMatches,
    ).toContain('gh\\s+pr\\s+create')
  })

  it('uses the materialized Run workflow profile snapshot before preloaded and project workflow config', () => {
    const context = createRepoContext()
    cleanup.push(context)
    const snapshotProfilePath = createProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: snapshot-profile
context:
  required_files: [SNAPSHOT.md]
verify:
  commands: ['pnpm snapshot']
push: {}
`)

    const { factory, builder } = seedBase(context)
    const ductumProject = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum-snapshot',
      repos: ['ductum'],
      config: {
        mergeMode: 'auto',
        workflowPath: 'workflows/coding-guard.yaml',
        workflowProfile: profilePath,
      },
    })
    const ductumSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: ductumProject.id,
      name: 'P2-snapshot',
      status: 'approved',
      document: '# P2 snapshot',
    })
    const rendered = loadRenderedWorkflowProfile(templatePath, snapshotProfilePath)
    const run = createRun(context, ductumSpec.id, builder.id, {
      id: createId<'ConfigResourceId'>(),
      name: 'runtime-snapshot',
      projectId: ductumProject.id,
      path: snapshotProfilePath,
      renderedWorkflow: rendered.renderedWorkflow,
      setupCommands: [],
      verifyCommands: rendered.profile.verify.commands,
    })
    const legacyPreloaded = loadRenderedWorkflow(templatePath, profilePath)
    const resolver = new WorkflowDefinitionResolver({
      fallbackWorkflowPath,
      templateWorkflowPath: templatePath,
      workflowDefsByProjectName: new Map([['ductum-snapshot', legacyPreloaded]]),
      runRepo: context.runRepo,
      taskRepo: context.taskRepo,
      specRepo: context.specRepo,
      projectRepo: context.projectRepo,
    })

    resolver.initialize()

    const selectedDefinition = resolver.getForRun(run.id)
    const readExitMessages = selectedDefinition.stages
      .find((stage) => stage.id === 'understand')
      ?.exit.map((gate) => gate.message) ?? []
    expect(readExitMessages).toContain('Read SNAPSHOT.md before editing')
    expect(readExitMessages).not.toContain('Read README.md before editing')
    expect(
      selectedDefinition.stages.find((stage) => stage.id === 'ship')?.checks[0]?.commandMatches,
    ).toContain('pnpm\\s+snapshot')
  })

})
