import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveGitHubReadAuth, resolveGitHubWriteAuth } from '../lib/github-auth.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  fixture?.close()
  fixture = undefined
})

describe('GitHub auth mode selection', () => {
  it('fails closed on production read auth when no GitHub App auth is configured', async () => {
    fixture = await createFixture()
    const repository = seedRepository(fixture)

    await expect(resolveGitHubReadAuth({
      factoryDir: mkdtempSync(join(tmpdir(), 'ductum-gh-read-auth-')),
      repository,
      secrets: fixture.repos.secrets,
      env: {},
    })).rejects.toThrow(/missing GitHub App installation auth/i)
  })

  it('uses PAT auth for reads only when dev mode is explicitly named', async () => {
    fixture = await createFixture()
    const repository = seedRepository(fixture)

    const auth = await resolveGitHubReadAuth({
      factoryDir: mkdtempSync(join(tmpdir(), 'ductum-gh-read-dev-')),
      repository,
      secrets: fixture.repos.secrets,
      env: {
        DUCTUM_GITHUB_DEV_READ_MODE: 'pat',
        DUCTUM_GITHUB_DEV_TOKEN: 'dev-read-token',
      },
    })

    expect(auth.actor).toEqual({ type: 'dev_pat', label: 'dev PAT' })
    expect(auth.token).toBe('dev-read-token')
  })

  it('fails closed on production write auth when no GitHub App auth is configured', async () => {
    fixture = await createFixture()
    const repository = seedRepository(fixture)

    await expect(resolveGitHubWriteAuth({
      factoryDir: mkdtempSync(join(tmpdir(), 'ductum-gh-write-auth-')),
      repository,
      secrets: fixture.repos.secrets,
      env: {},
    })).rejects.toThrow(/missing GitHub App installation auth/i)
  })
})

function seedRepository(fixture: TestFixture) {
  const { project } = seedBase(fixture)
  return fixture.repos.repositories.create({
    id: createId<'RepositoryId'>() as never,
    projectId: project.id,
    name: 'ductum',
    spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
  })
}
