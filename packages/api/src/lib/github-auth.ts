import { createSign } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { FactorySecretResolver, type Repository } from '@ductum/core'

import { ValidationError } from './errors.js'

const execFileAsync = promisify(execFile)

export interface GitHubActorIdentity {
  type: 'github_app' | 'dev_pat' | 'dev_gh_cli'
  label: string
}

export interface GitHubResolvedAuth {
  token: string
  actor: GitHubActorIdentity
}

export interface ResolveGitHubWriteAuthInput {
  factoryDir: string
  repository: Pick<Repository, 'name' | 'spec'>
  secrets: { get(id: string): unknown }
  apiBaseUrl?: string
  env?: NodeJS.ProcessEnv
}

export async function resolveGitHubWriteAuth(input: ResolveGitHubWriteAuthInput): Promise<GitHubResolvedAuth> {
  const env = input.env ?? process.env
  const authRef = input.repository.spec.authRef?.trim()
  if (authRef != null && authRef !== '') {
    return await resolveRepositoryGitHubAppAuth(input, authRef)
  }
  const devMode = env.DUCTUM_GITHUB_DEV_WRITE_MODE?.trim()
  if (devMode === 'pat') {
    const token = env.DUCTUM_GITHUB_DEV_TOKEN?.trim() || env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim()
    if (token == null || token === '') {
      throw new ValidationError('DUCTUM_GITHUB_DEV_WRITE_MODE=pat requires DUCTUM_GITHUB_DEV_TOKEN, GH_TOKEN, or GITHUB_TOKEN')
    }
    return { token, actor: { type: 'dev_pat', label: 'dev PAT' } }
  }
  if (devMode === 'gh-cli') {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { encoding: 'utf-8', timeout: 10_000 })
    const token = stdout.trim()
    if (token === '') throw new ValidationError('gh auth token returned an empty token')
    return { token, actor: { type: 'dev_gh_cli', label: 'dev gh cli' } }
  }
  throw new ValidationError(
    `Repository ${input.repository.name} is missing GitHub App installation auth. Production write paths fail closed; set repository.authRef to GitHub App credentials or explicitly set DUCTUM_GITHUB_DEV_WRITE_MODE for dev-only writes.`,
  )
}

interface GitHubAppSecret {
  mode: 'github_app'
  appId: string
  installationId: string
  privateKey: string
}

async function resolveRepositoryGitHubAppAuth(
  input: ResolveGitHubWriteAuthInput,
  authRef: string,
): Promise<GitHubResolvedAuth> {
  const resolver = new FactorySecretResolver({ factoryDir: input.factoryDir, secrets: input.secrets as never })
  const raw = resolver.resolve(authRef)
  const parsed = parseGitHubAppSecret(raw)
  const token = await requestInstallationToken(
    input.apiBaseUrl ?? 'https://api.github.com',
    parsed.appId,
    parsed.installationId,
    parsed.privateKey,
  )
  return {
    token,
    actor: { type: 'github_app', label: `GitHub App ${parsed.appId} installation ${parsed.installationId}` },
  }
}

function parseGitHubAppSecret(value: string): GitHubAppSecret {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new ValidationError('GitHub auth secret must be JSON')
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('GitHub auth secret must be an object')
  }
  const record = parsed as Record<string, unknown>
  const mode = typeof record.mode === 'string' ? record.mode.trim() : ''
  const appId = typeof record.appId === 'string' ? record.appId.trim() : String(record.appId ?? '').trim()
  const installationId = typeof record.installationId === 'string'
    ? record.installationId.trim()
    : String(record.installationId ?? '').trim()
  const privateKey = typeof record.privateKey === 'string'
    ? record.privateKey
    : typeof record.privateKeyPem === 'string'
      ? record.privateKeyPem
      : ''
  if (mode !== 'github_app' || appId === '' || installationId === '' || privateKey.trim() === '') {
    throw new ValidationError('GitHub auth secret must include mode=github_app, appId, installationId, and privateKey')
  }
  return { mode: 'github_app', appId, installationId, privateKey }
}

async function requestInstallationToken(
  apiBaseUrl: string,
  appId: string,
  installationId: string,
  privateKey: string,
): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${createGitHubAppJwt(appId, privateKey)}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new ValidationError(`GitHub App installation token request failed: ${response.status} ${await response.text()}`)
  }
  const payload = await response.json() as { token?: string }
  const token = payload.token?.trim()
  if (token == null || token === '') throw new ValidationError('GitHub App installation token response was missing token')
  return token
}

function createGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = encodeJwtPart({ alg: 'RS256', typ: 'JWT' })
  const payload = encodeJwtPart({ iat: now - 60, exp: now + 540, iss: appId })
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  const signature = signer.sign(privateKey, 'base64url')
  return `${header}.${payload}.${signature}`
}

function encodeJwtPart(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
