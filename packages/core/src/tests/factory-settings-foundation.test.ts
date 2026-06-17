import { afterEach, describe, expect, it } from 'vitest'

import {
  ConfigBackedFactoryCatalogRepo,
  SqliteFactoryRuntimeSettingsRepo,
  SqliteFactorySecretRepo,
} from '../index.js'
import { createRepoContext, seedBase } from './helpers.js'

let context: ReturnType<typeof createRepoContext> | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

describe('Factory Settings DB foundation', () => {
  it('persists desired runtime settings outside Factory config', () => {
    context = createRepoContext()
    const { factory } = seedBase(context)
    const repo = new SqliteFactoryRuntimeSettingsRepo(context.db)

    expect(repo.get(factory.id)).toBeNull()

    const desired = repo.upsert(factory.id, {
      apiBindHost: '127.0.0.1',
      apiPort: 4100,
      dispatcherEnabled: false,
      worktreeBasePath: '/tmp/ductum-worktrees',
    })

    expect(desired).toMatchObject({
      factoryId: factory.id,
      apiBindHost: '127.0.0.1',
      apiPort: 4100,
      dispatcherEnabled: false,
      worktreeBasePath: '/tmp/ductum-worktrees',
    })
    expect(context.factoryRepo.get()?.config).toEqual(factory.config)

    const updated = repo.upsert(factory.id, {
      apiPort: null,
      publicApiUrl: 'https://factory.example.test',
    })

    expect(updated.apiBindHost).toBe('127.0.0.1')
    expect(updated.apiPort).toBeNull()
    expect(updated.publicApiUrl).toBe('https://factory.example.test')
  })

  it('stores secret ciphertext while public secret metadata omits material', () => {
    context = createRepoContext()
    const { project } = seedBase(context)
    const repo = new SqliteFactorySecretRepo(context.db)

    const stored = repo.create({
      id: 'secret-1',
      name: 'openai-api-key',
      scope: 'factory',
      projectId: null,
      description: 'OpenAI API key',
      status: 'configured',
      keySource: { type: 'local-file', keyId: 'local-key-1' },
      payload: {
        algorithm: 'aes-256-gcm',
        ciphertext: 'encrypted-secret-ciphertext',
        nonce: 'nonce-1',
        authTag: 'tag-1',
      },
      lastRotatedAt: '2026-06-10T00:00:00Z',
      lastTestedAt: null,
    })

    expect(repo.get(stored.id)).toMatchObject({
      keySource: { type: 'local-file', keyId: 'local-key-1' },
      payload: { ciphertext: 'encrypted-secret-ciphertext' },
    })

    const metadata = repo.getMetadata(stored.id)
    expect(metadata).toMatchObject({
      id: 'secret-1',
      name: 'openai-api-key',
      scope: 'factory',
      status: 'configured',
    })
    expect(Object.keys(metadata ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'lastRotatedAt',
      'lastTestedAt',
      'name',
      'scope',
      'status',
      'updatedAt',
    ])
    expect(metadata).toMatchObject({
      id: 'secret-1',
      name: 'openai-api-key',
      status: 'configured',
    })
    expect(metadata).not.toHaveProperty('payload')
    expect(metadata).not.toHaveProperty('ciphertext')
    expect(metadata).not.toHaveProperty('keySource')
    expect(metadata).not.toHaveProperty('projectId')
    expect(metadata).not.toHaveProperty('description')

    repo.create({
      id: 'secret-project-1',
      name: 'github-token',
      scope: 'project',
      projectId: project.id,
      description: null,
      status: 'missing',
      keySource: { type: 'local-file', keyId: 'local-key-2' },
      payload: {
        algorithm: 'aes-256-gcm',
        ciphertext: 'project-secret-ciphertext',
        nonce: 'nonce-2',
        authTag: null,
      },
      lastRotatedAt: null,
      lastTestedAt: null,
    })

    expect(repo.list({ projectId: project.id })).toEqual([
      expect.objectContaining({ id: 'secret-project-1', scope: 'project', status: 'missing' }),
    ])
    expect(repo.list({ projectId: null })).toEqual([
      expect.objectContaining({ id: 'secret-1', scope: 'factory' }),
    ])
    expect(() => repo.create({
      id: 'secret-duplicate',
      name: 'openai-api-key',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: { type: 'local-file', keyId: 'local-key-3' },
      payload: {
        algorithm: 'aes-256-gcm',
        ciphertext: 'duplicate-ciphertext',
        nonce: 'nonce-3',
        authTag: null,
      },
      lastRotatedAt: null,
      lastTestedAt: null,
    })).toThrow(/UNIQUE/)

    expect(repo.updateMetadata(stored.id, { lastTestedAt: '2026-06-10T01:00:00Z' }).lastTestedAt)
      .toBe('2026-06-10T01:00:00Z')
  })

  it('exposes typed catalog methods over saved catalog rows', () => {
    context = createRepoContext()
    seedBase(context)
    context.configResourceRepo.create({
      id: 'model-1' as never,
      kind: 'Model',
      projectId: null,
      name: 'gpt-5-4',
      spec: { provider: 'openai', modelId: 'gpt-5.4' },
    })
    context.configResourceRepo.create({
      id: 'harness-1' as never,
      kind: 'Harness',
      projectId: null,
      name: 'codex-sdk',
      spec: { type: 'codex-sdk' },
    })

    const repo = new ConfigBackedFactoryCatalogRepo(context.configResourceRepo)

    expect(repo.listProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'openai' }),
    ]))
    expect(repo.listModels()).toEqual([expect.objectContaining({ modelId: 'gpt-5-4' })])
    expect(repo.listHarnesses()).toEqual([expect.objectContaining({ harnessId: 'codex-sdk' })])
  })
})
