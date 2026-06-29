import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'

import {
  createId,
  encryptFactorySecret,
  formatFactorySecretRef,
  loadFactorySecretKey,
} from '@ductum/core'

import { join, tmpdir, type TestFixture } from './shared.js'

export function seedFactorySecretDir(): string {
  const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-gh-merge-'))
  mkdirSync(join(factoryDir, '.ductum'), { recursive: true })
  writeFileSync(join(factoryDir, '.ductum', 'secrets.key'), randomBytes(32), { mode: 0o600 })
  chmodSync(join(factoryDir, '.ductum', 'secrets.key'), 0o600)
  return factoryDir
}

export function seedRepositoryWithAuth(fixture: TestFixture, projectId: string, factoryDir: string) {
  const loadedKey = loadFactorySecretKey(factoryDir)
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey
  const encrypted = encryptFactorySecret(JSON.stringify({
    mode: 'github_app',
    appId: '123',
    installationId: '456',
    privateKey,
  }), loadedKey)
  fixture.repos.secrets.create({
    id: 'github-app',
    name: 'github-app',
    scope: 'project',
    projectId: projectId as never,
    description: null,
    status: 'configured',
    keySource: encrypted.keySource,
    payload: encrypted.payload,
    lastRotatedAt: null,
    lastTestedAt: null,
  })
  return fixture.repos.repositories.create({
    id: createId<'RepositoryId'>() as never,
    projectId: projectId as never,
    name: 'ductum',
    spec: {
      remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      authRef: formatFactorySecretRef('github-app'),
    },
  })
}

/**
 * Issue #195: the GitHub App merge path now fetches live CI checks for the
 * pinned PR head before calling `/pulls/:n/merge`. Tests that exercise a
 * successful GitHub App merge must mock the check-runs and statuses
 * endpoints to return a strictly green CI set. Pass the same `headSha` that
 * the run records as `commitSha`.
 */
export function buildGreenCheckRunsResponse(headSha: string): {
  checkRunsUrl: string
  statusesUrl: string
  checkRunsBody: string
  statusesBody: string
} {
  return {
    checkRunsUrl: `/commits/${headSha}/check-runs?per_page=100`,
    statusesUrl: `/commits/${headSha}/statuses?per_page=100`,
    checkRunsBody: JSON.stringify({
      check_runs: [
        { name: 'audit', status: 'completed', conclusion: 'success' },
        { name: 'build-and-test', status: 'completed', conclusion: 'success' },
      ],
    }),
    statusesBody: JSON.stringify([]),
  }
}

