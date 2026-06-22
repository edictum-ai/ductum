const REVIEWED_COMMIT_LABEL = 'Reviewed Commit'
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i

export function buildReviewedCommitSection(commitSha: string | null | undefined): string[] {
  const normalized = normalizeCommitSha(commitSha)
  if (normalized == null) return []
  return ['### Review Target', '', `${REVIEWED_COMMIT_LABEL}: ${normalized}`, '']
}

export function parseReviewedCommitSha(prompt: string): string | undefined {
  const match = prompt.match(/^Reviewed Commit:\s*([0-9a-f]{7,64})\s*$/im)
  return normalizeCommitSha(match?.[1])
}

function normalizeCommitSha(commitSha: string | null | undefined): string | undefined {
  const trimmed = commitSha?.trim()
  if (trimmed == null || trimmed === '') return undefined
  return SHA_PATTERN.test(trimmed) ? trimmed : undefined
}
