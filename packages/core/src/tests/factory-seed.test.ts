import { afterEach, describe, expect, it } from 'vitest'

import {
  seedInitialFactoryDatabase,
  SqliteFactoryRuntimeSettingsRepo,
} from '../index.js'
import { createRepoContext } from './helpers.js'

let context: ReturnType<typeof createRepoContext> | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

describe('initial Factory DB seed', () => {
  it('creates a complete DB-only Factory baseline', () => {
    context = createRepoContext()

    const result = seedInitialFactoryDatabase({
      db: context.db,
      factoryDir: '/tmp/factory',
      projectName: 'factory',
      agents: ['anthropic', 'codex', 'copilot'],
    })

    expect(result.factory.name).toBe('factory')
    expect((result.factory.config as unknown as { costBudget?: unknown }).costBudget)
      .toEqual({ perSpecHardUsd: 200 })
    expect(new SqliteFactoryRuntimeSettingsRepo(context.db).get(result.factory.id)).toMatchObject({
      apiBindHost: '127.0.0.1',
      apiPort: 4100,
      dispatcherEnabled: true,
      dispatcherHeartbeatIntervalSeconds: 30,
      worktreeEnabled: true,
      worktreeBasePath: '/tmp/factory/.ductum/worktrees',
    })
    expect(context.projectRepo.list(result.factory.id)).toEqual([
      expect.objectContaining({ id: result.project.id, name: 'factory', repos: ['.'] }),
    ])
    expect(context.repositoryRepo.list(result.project.id)).toEqual([
      expect.objectContaining({ id: result.repository.id, name: '.', spec: expect.objectContaining({ localPath: '.' }) }),
    ])
    expect(context.componentRepo.list(result.repository.id)).toEqual([
      expect.objectContaining({ id: result.component.id, name: 'root', spec: { path: '.' } }),
    ])
    expect(context.agentRepo.list().map((agent) => agent.name).sort()).toEqual([
      'claude-builder',
      'claude-reviewer',
      'codex-builder',
      'copilot-builder',
    ])
    expect(context.agentRepo.list().map((agent) => agent.resourceRefs?.systemPromptRef))
      .toEqual([undefined, undefined, undefined, undefined])
    const agentRepo = context.agentRepo
    expect(context.projectAgentRepo.getByRole(result.project.id, 'builder').map((assignment) => {
      return agentRepo.get(assignment.agentId)?.name
    }).sort()).toEqual(['claude-builder', 'codex-builder', 'copilot-builder'])
    expect(context.projectAgentRepo.getByRole(result.project.id, 'reviewer').map((assignment) => {
      return agentRepo.get(assignment.agentId)?.name
    })).toEqual(['claude-reviewer'])
    expect(context.configResourceRepo.getByName('Model', 'gpt-5.5')).toMatchObject({
      spec: {
        provider: 'openai',
        modelId: 'gpt-5.5',
        scannerSource: 'codex',
        sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.5',
        lastVerifiedAt: '2026-06-13',
        enabled: true,
      },
    })
    expect(context.configResourceRepo.getByName('Model', 'glm-5.2')).toMatchObject({
      spec: expect.objectContaining({
        provider: 'zai',
        modelId: 'glm-5.2',
        scannerSource: 'claude',
        lastVerifiedAt: '2026-06-13',
      }),
    })
    expect(context.configResourceRepo.getByName('Model', 'gpt-5.5-pro')).toMatchObject({
      spec: expect.objectContaining({ provider: 'openai', modelId: 'gpt-5.5-pro' }),
    })
    expect(context.configResourceRepo.getByName('Model', 'claude-fable-5')).toMatchObject({
      spec: expect.objectContaining({ provider: 'anthropic', modelId: 'claude-fable-5' }),
    })
    expect(context.configResourceRepo.getByName('Model', 'gpt-5.3-codex-spark')?.spec)
      .not.toHaveProperty('pricing')
    expect(context.configResourceRepo.getByName('Model', 'github-copilot-gpt-5-4')).toMatchObject({
      spec: { provider: 'github-copilot', modelId: 'gpt-5.4' },
    })
    expect(context.configResourceRepo.getByName('Harness', 'copilot-sdk')).toMatchObject({
      spec: { type: 'copilot-sdk' },
    })
    expect(context.configResourceRepo.getByName('WorkflowProfile', 'coding-guard')).toMatchObject({
      spec: { path: 'workflows/coding-guard-profile.yaml' },
    })
    expect(context.configResourceRepo.getByName('WorkflowProfile', 'coding-guard', result.project.id)).toMatchObject({
      spec: { path: '/tmp/factory/.edictum/workflow-profile.yaml' },
    })
    expect(context.configResourceRepo.getByName('SandboxProfile', 'worktree-default')).toMatchObject({
      spec: { provider: 'host', mode: 'worktree' },
    })
  })

  it('creates separate Claude builder and reviewer agents when Anthropic is the only provider', () => {
    context = createRepoContext()

    const result = seedInitialFactoryDatabase({
      db: context.db,
      factoryDir: '/tmp/factory',
      projectName: 'factory',
      agents: ['anthropic'],
    })

    const agentRepo = context.agentRepo
    expect(agentRepo.list().map((agent) => [agent.name, agent.model]).sort()).toEqual([
      ['claude-builder', 'claude-sonnet-4-6'],
      ['claude-reviewer', 'claude-opus-4-8'],
    ])
    expect(context.projectAgentRepo.getByRole(result.project.id, 'builder').map((assignment) => {
      return agentRepo.get(assignment.agentId)?.model
    })).toEqual(['claude-sonnet-4-6'])
    expect(context.projectAgentRepo.getByRole(result.project.id, 'reviewer').map((assignment) => {
      return agentRepo.get(assignment.agentId)?.model
    })).toEqual(['claude-opus-4-8'])
  })

  it('refuses to seed over existing Factory state', () => {
    context = createRepoContext()
    seedInitialFactoryDatabase({ db: context.db, factoryDir: '/tmp/factory', projectName: 'factory' })

    expect(() =>
      seedInitialFactoryDatabase({ db: context!.db, factoryDir: '/tmp/factory', projectName: 'factory' }),
    ).toThrow(/already contains Factory state/)
  })
})
