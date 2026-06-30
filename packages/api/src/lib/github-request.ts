import { ValidationError } from './errors.js'
import type { GitHubRepoRef } from './github-ref.js'
import { toGitHubApiBaseUrl } from './github-ref.js'

export async function requestGitHubJson<T>(
  repo: GitHubRepoRef,
  path: string,
  options: { method?: string; token?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const response = await requestGitHubResponse(repo, path, options)
  return await response.json() as T
}

export async function requestGitHubResponse(
  repo: GitHubRepoRef,
  url: string,
  options: { method?: string; token?: string; body?: Record<string, unknown> } = {},
): Promise<Response> {
  const isAbsoluteUrl = /^https?:\/\//i.test(url)
  const fullUrl = isAbsoluteUrl ? url : `${toGitHubApiBaseUrl(repo)}${url}`
  const response = await fetch(fullUrl, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.token == null ? {} : { Authorization: `Bearer ${options.token}` }),
      ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body == null ? {} : { body: JSON.stringify(options.body) }),
  })
  if (!response.ok) {
    throw new ValidationError(`GitHub request failed (${response.status}): ${await response.text()}`)
  }
  return response
}
