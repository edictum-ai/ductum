import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
const tempDirs: string[] = []

afterEach(() => {
  fixture?.close()
  fixture = undefined
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('project workflow profile routes', () => {
  it('resolves stored project workflow refs through API enforcement', async () => {
    fixture = await createFixture()
    seedFactory(fixture)
    const repoDir = tempRepo()
    const workflowPath = writeWorkflowProfile(repoDir, 'api-project-workflow')

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'api-project',
        repository: { localPath: repoDir },
        config: { workflowProfile: workflowPath },
      },
    })
    const project = created.json as { id: string; config: { workflowProfileRef: string } }
    const agent = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'builder',
      model: 'claude-opus-4.6',
      harness: 'claude-agent-sdk',
      capabilities: ['build'],
      costTier: 90,
      spawnConfig: {},
    })
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id as never,
      name: 'workflow-ref',
      status: 'approved',
      document: '# workflow ref',
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'uses project workflow',
      prompt: 'implement',
      repos: ['api-project'],
      assignedAgentId: agent.id,
      status: 'active',
      verification: ['pnpm test'],
    })
    const run = fixture.repos.runs.create({
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

    expect(project.config.workflowProfileRef).toEqual(expect.any(String))
    await expect(fixture.context.enforcement.getWorkflowState(run.id)).resolves.toMatchObject({
      activeStage: 'understand',
    })
  })

  it('rolls back a created workflow record when project update fails', async () => {
    fixture = await createFixture()
    const factory = seedFactory(fixture)
    const source = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'source-project',
      repos: ['source'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'duplicate-project',
      repos: ['duplicate'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const workflowPath = writeWorkflowProfile(tempRepo(), 'rolled-back-workflow')

    const updated = await requestJson(fixture.app, `/api/projects/${source.id}`, {
      method: 'PUT',
      body: {
        name: 'duplicate-project',
        config: { workflowProfile: workflowPath },
      },
    })

    expect(updated.response.status).toBeGreaterThanOrEqual(400)
    expect(
      fixture.repos.configResources
        .list({ kind: 'WorkflowProfile' })
        .some((resource) => resource.name === 'rolled-back-workflow'),
    ).toBe(false)
    expect(fixture.repos.projects.get(source.id)?.config.workflowProfileRef).toBeUndefined()
  })
})

function seedFactory(current: TestFixture) {
  return current.repos.factory.create({
    id: createId<'FactoryId'>(),
    name: 'Ductum',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
}

function tempRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'ductum-project-workflow-'))
  tempDirs.push(repoDir)
  mkdirSync(join(repoDir, '.edictum'))
  writeFileSync(join(repoDir, 'README.md'), '# Test repo\n')
  return repoDir
}

function writeWorkflowProfile(repoDir: string, name: string): string {
  const workflowPath = join(repoDir, '.edictum', 'workflow-profile.yaml')
  writeFileSync(workflowPath, [
    'apiVersion: edictum/v1alpha1',
    'kind: WorkflowProfile',
    'metadata:',
    `  name: ${name}`,
    'context:',
    '  required_files: [README.md]',
    'verify:',
    "  commands: ['pnpm test']",
    'push: {}',
    '',
  ].join('\n'))
  return workflowPath
}
