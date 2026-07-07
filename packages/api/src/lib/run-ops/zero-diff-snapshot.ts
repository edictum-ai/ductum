import { validateEvidencePayload, type Run } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { nonBlank } from './common.js'

export function hasCurrentZeroDiffWorktreeSnapshot(
  context: ApiContext,
  run: Pick<Run, 'id' | 'branch' | 'commitSha'>,
): boolean {
  const branch = run.branch?.trim()
  const commitSha = run.commitSha?.trim()
  if (!nonBlank(branch) || !nonBlank(commitSha)) return false

  const evidence = context.repos.evidence.list(run.id)
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const payload = evidence[index]?.payload
    if (!validateEvidencePayload(payload) || payload.kind !== 'worktree.snapshot') continue
    return payload.branch.trim() === branch
      && payload.commitSha.trim() === commitSha
      && payload.diffStat.filesChanged === 0
      && payload.diffStat.insertions === 0
      && payload.diffStat.deletions === 0
  }
  return false
}
