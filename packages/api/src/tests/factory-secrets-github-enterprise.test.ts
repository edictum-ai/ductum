import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createId, formatFactorySecretRef } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fixture?.close()
  fixture = undefined
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('Factory secrets - GitHub Enterprise', () => {
  it('tests GitHub App secrets against the enterprise API base for linked repositories', async () => {
    const factoryDir = await factoryDirWithKey()
    fixture = await createFixture({ factoryDataDir: factoryDir })
    const { project } = seedBase(fixture)
    const privateKey = githubPrivateKey()
    const value = JSON.stringify({
      mode: 'github_app',
      appId: '123',
      installationId: '456',
      privateKey,
    })
    const created = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'github-enterprise-app', value },
    })
    const id = (created.json as { id: string }).id
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>(),
      projectId: project.id,
      name: 'enterprise-ductum',
      spec: {
        remoteUrl: 'https://ghe.example.com/edictum-ai/ductum.git',
        authRef: formatFactorySecretRef(id),
      },
    })
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://ghe.example.com/api/v3/app/installations/456/access_tokens')
      return new Response(JSON.stringify({ token: 'enterprise-app-token' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const tested = await requestJson(fixture.app, `/api/factory/secrets/${id}/test`, { method: 'POST' })

    expect(tested.response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(tested.json).toMatchObject({ id, status: 'configured' })
    expect(tested.text).not.toContain(privateKey)
    expect(tested.text).not.toContain('enterprise-app-token')
  })

  it('rejects linked repository auth refs that are not GitHub App secrets', async () => {
    const factoryDir = await factoryDirWithKey()
    fixture = await createFixture({ factoryDataDir: factoryDir })
    const { project } = seedBase(fixture)
    const value = JSON.stringify({ appId: 'generic-app', privateKey: 'not-a-github-key' })
    const created = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'generic-json-app', value },
    })
    const id = (created.json as { id: string }).id
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>(),
      projectId: project.id,
      name: 'linked-ductum',
      spec: {
        remoteUrl: 'https://github.com/edictum-ai/ductum.git',
        authRef: formatFactorySecretRef(id),
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const tested = await requestJson(fixture.app, `/api/factory/secrets/${id}/test`, { method: 'POST' })

    expect(tested.response.status).toBe(400)
    expect(tested.text).toContain('repository.authRef linked secrets must be GitHub App secrets')
    expect(tested.text).not.toContain('not-a-github-key')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fixture.repos.secrets.getMetadata(id)).toMatchObject({
      status: 'test_failed',
      lastTestedAt: null,
    })
  })

  it('reports GitHub App token fetch rejections as validation failures', async () => {
    const factoryDir = await factoryDirWithKey()
    fixture = await createFixture({ factoryDataDir: factoryDir })
    const { project } = seedBase(fixture)
    const privateKey = githubPrivateKey()
    const value = JSON.stringify({
      mode: 'github_app',
      appId: '123',
      installationId: '456',
      privateKey,
    })
    const created = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'unreachable-github-app', value },
    })
    const id = (created.json as { id: string }).id
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>(),
      projectId: project.id,
      name: 'enterprise-ductum',
      spec: {
        remoteUrl: 'https://ghe.example.com/edictum-ai/ductum.git',
        authRef: formatFactorySecretRef(id),
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND ghe.example.com')
    }))

    const tested = await requestJson(fixture.app, `/api/factory/secrets/${id}/test`, { method: 'POST' })

    expect(tested.response.status).toBe(400)
    expect(tested.text).toContain('GitHub App installation token request failed before response')
    expect(tested.text).toContain('[redacted]')
    expect(tested.text).not.toContain(privateKey)
    expect(fixture.repos.secrets.getMetadata(id)).toMatchObject({
      status: 'test_failed',
      lastTestedAt: null,
    })
  })

  it('rejects Target-backed auth refs that are not GitHub App secrets', async () => {
    const factoryDir = await factoryDirWithKey()
    fixture = await createFixture({ factoryDataDir: factoryDir })
    const { project } = seedBase(fixture)
    const value = JSON.stringify({ appId: 'generic-app', privateKey: 'not-a-github-key' })
    const created = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'target-generic-json-app', value },
    })
    const id = (created.json as { id: string }).id
    fixture.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: project.id,
      name: 'target-ductum',
      spec: {
        source: { type: 'github', repo: 'https://github.com/edictum-ai/target-ductum.git' },
        authRef: formatFactorySecretRef(id),
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const tested = await requestJson(fixture.app, `/api/factory/secrets/${id}/test`, { method: 'POST' })

    expect(tested.response.status).toBe(400)
    expect(tested.text).toContain('repository.authRef linked secrets must be GitHub App secrets')
    expect(tested.text).not.toContain('not-a-github-key')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fixture.repos.secrets.getMetadata(id)).toMatchObject({
      status: 'test_failed',
      lastTestedAt: null,
    })
  })
})

async function factoryDirWithKey(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-api-secrets-enterprise-'))
  dirs.push(dir)
  await mkdir(join(dir, '.ductum'), { recursive: true })
  const keyPath = join(dir, '.ductum', 'secrets.key')
  await writeFile(keyPath, randomBytes(32), { mode: 0o600 })
  await chmod(keyPath, 0o600)
  return dir
}

function githubPrivateKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey
}
