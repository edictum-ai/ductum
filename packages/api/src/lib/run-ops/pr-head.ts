import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Repository, Run } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubReadAuth } from '../github-auth.js'
import { fetchGitHubPullRequest } from '../github-client.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../github-ref.js'
import { nonBlank } from './common.js'
import { pickPrReference, resolveGitHubPullNumber } from './merge-utils.js'

const execFileAsync = promisify(execFile)

export async function resolveCurrentPrHeadSha(
  context: ApiContext,
  run: Pick<Run, 'id' | 'taskId' | 'prNumber' | 'prUrl'>,
): Promise<string | null> {
  const repository = resolveRunRepository(context, run)
  const repoRef = repository == null ? null : parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repository != null && repoRef != null) {
    const auth = await resolveGitHubReadAuth({
      factoryDir: context.factoryDataDir ?? process.cwd(),
      repository,
      secrets: context.repos.secrets,
      secretAccessLog: context.repos.secretAccessLog,
      secretAccessContext: { runId: run.id },
      apiBaseUrl: toGitHubApiBaseUrl(repoRef),
    })
    const pull = await fetchGitHubPullRequest({
      repo: repoRef,
      token: auth.token,
      pullNumber: resolveGitHubPullNumber(run, repoRef),
    })
    return nonBlank(pull.head.sha) ? pull.head.sha : null
  }
  if (process.env.DUCTUM_GITHUB_DEV_WRITE_MODE?.trim() !== 'gh-cli') return null
  const prRef = pickPrReference(run)
  if (prRef == null) return null
  const { stdout } = await execFileAsync('gh', ['pr', 'view', prRef, '--json', 'headRefOid'], {
    encoding: 'utf-8',
    timeout: 30_000,
  })
  const headSha = (JSON.parse(stdout) as { headRefOid?: string | null }).headRefOid?.trim()
  return headSha == null || headSha === '' ? null : headSha
}

function resolveRunRepository(context: ApiContext, run: Pick<Run, 'taskId'>): Repository | null {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return null
  return context.repos.repositories.get(task.repositoryId as never)
}
