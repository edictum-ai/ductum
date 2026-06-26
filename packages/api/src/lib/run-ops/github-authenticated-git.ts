import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log } from '@ductum/core'

import type { GitHubRepoRef } from '../github-ref.js'
import { nonBlank } from './common.js'

const execFileAsync = promisify(execFile)

export function buildGitHubAuthenticatedPullArgs(input: {
  upstreamPath: string
  repo: GitHubRepoRef
  token: string
  base: string
}): string[] {
  const authHeader = Buffer.from(`x-access-token:${input.token}`).toString('base64')
  return [
    '-C',
    input.upstreamPath,
    '-c',
    `http.${`https://${input.repo.host}/`}.extraheader=AUTHORIZATION: basic ${authHeader}`,
    'pull',
    '--ff-only',
    'origin',
    input.base,
  ]
}

export async function pullGitHubBaseBranch(input: {
  upstreamPath: string | null | undefined
  repo: GitHubRepoRef
  token: string
  base: string
}): Promise<void> {
  if (!nonBlank(input.upstreamPath)) return
  try {
    await execFileAsync(
      'git',
      buildGitHubAuthenticatedPullArgs({
        upstreamPath: input.upstreamPath,
        repo: input.repo,
        token: input.token,
        base: input.base,
      }),
      { encoding: 'utf-8', timeout: 30_000 },
    )
  } catch (error) {
    log.warn('merge', `pull of ${input.base} after GitHub API PR merge failed (non-fatal): ${formatGitFailure(error)}`)
  }
}

function formatGitFailure(error: unknown): string {
  const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
    ? (error as { stderr: string }).stderr.trim()
    : ''
  if (stderr !== '') return stderr
  const code = (error as { code?: unknown }).code
  if (code != null) return `git exited with code ${String(code)}`
  return 'git command failed'
}
