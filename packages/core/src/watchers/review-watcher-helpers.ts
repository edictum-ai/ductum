import type { ReviewResult } from '../watcher.js'

const REVIEW_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewDecision
      latestReviews(first: 100) {
        nodes {
          author { login }
          state
          body
          submittedAt
        }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 20) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}
`.trim()

interface RawReview {
  author?: { login?: string | null } | string | null
  state?: string | null
  body?: string | null
  submittedAt?: string | null
}

interface RawThreadComment {
  author?: { login?: string | null } | string | null
  body?: string | null
}

interface RawReviewThread {
  isResolved?: boolean | null
  isOutdated?: boolean | null
  path?: string | null
  line?: number | null
  comments?: RawThreadComment[] | { nodes?: RawThreadComment[] | null } | null
}

interface RawReviewSummary {
  reviewDecision?: string | null
  latestReviews?: RawReview[] | { nodes?: RawReview[] | null } | null
  reviewThreads?: RawReviewThread[] | { nodes?: RawReviewThread[] | null } | null
}

export function buildGithubReviewQueryArgs(prUrl: string): string[] {
  const pr = parsePrUrl(prUrl)
  return [
    'api',
    'graphql',
    '-F',
    `owner=${pr.owner}`,
    '-F',
    `repo=${pr.repo}`,
    '-F',
    `number=${pr.number}`,
    '-f',
    `query=${REVIEW_QUERY}`,
  ]
}

export function parseGithubReviewPayload(payload: unknown): ReviewResult | null {
  const summary = extractReviewSummary(payload)
  if (summary == null) return null

  const reviews = asNodes<RawReview>(summary.latestReviews).map(normalizeReview)
  const threads = asNodes<RawReviewThread>(summary.reviewThreads)
  const decision = normalizeDecision(summary.reviewDecision)
  const warningFindings = collectWarningFindings(reviews, threads)

  if (decision === 'changes_requested') {
    const failing = pickLatestReview(reviews, 'changes_requested')
    return {
      reviewer: failing?.reviewer ?? summarizeReviewers(reviews.filter((review) => review.status === 'changes_requested').map((review) => review.reviewer)),
      status: 'changes_requested',
      findings: uniqueStrings([...(failing?.findings ?? []), ...warningFindings]),
    }
  }

  if (decision === 'approved' && warningFindings.length === 0) {
    const approved = pickLatestReview(reviews, 'approved')
    return {
      reviewer: approved?.reviewer ?? 'unknown',
      status: 'approved',
      findings: [],
    }
  }

  if (warningFindings.length > 0) {
    return {
      reviewer: summarizeWarningReviewers(reviews, threads),
      status: 'commented',
      findings: warningFindings,
    }
  }

  return null
}

function parsePrUrl(prUrl: string): { owner: string; repo: string; number: number } {
  const url = new URL(prUrl)
  const parts = url.pathname.split('/').filter(Boolean)
  const number = Number(parts[3])
  if (parts.length < 4 || parts[2] !== 'pull' || !Number.isInteger(number)) {
    throw new Error(`Unsupported GitHub PR URL: ${prUrl}`)
  }
  return { owner: parts[0]!, repo: parts[1]!, number }
}

function extractReviewSummary(payload: unknown): RawReviewSummary | null {
  if (!isRecord(payload)) return null
  const data = isRecord(payload.data) ? payload.data : null
  const repository = data != null && isRecord(data.repository) ? data.repository : null
  const pullRequest = repository != null && isRecord(repository.pullRequest)
    ? repository.pullRequest
    : null
  return (pullRequest ?? payload) as RawReviewSummary
}

function asNodes<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.nodes)) {
    return value.nodes as T[]
  }
  return []
}

function normalizeReview(review: RawReview): ReviewResult & { submittedAt: string | null } {
  return {
    reviewer: getReviewer(review.author),
    status: normalizeState(review.state),
    findings: getFindings(review.body),
    submittedAt: review.submittedAt ?? null,
  }
}

function normalizeState(state: string | null | undefined): ReviewResult['status'] {
  const value = (state ?? 'pending').toLowerCase()
  if (value === 'approved') return 'approved'
  if (value === 'changes_requested') return 'changes_requested'
  if (value === 'commented') return 'commented'
  return 'pending'
}

function normalizeDecision(decision: string | null | undefined): ReviewResult['status'] {
  const value = (decision ?? 'pending').toLowerCase()
  if (value === 'approved') return 'approved'
  if (value === 'changes_requested') return 'changes_requested'
  return 'pending'
}

function pickLatestReview(
  reviews: Array<ReviewResult & { submittedAt: string | null }>,
  status: ReviewResult['status'],
): (ReviewResult & { submittedAt: string | null }) | null {
  const matching = reviews.filter((review) => review.status === status)
  if (matching.length === 0) return null
  return matching.sort((left, right) => {
    const leftTime = left.submittedAt == null ? 0 : Date.parse(left.submittedAt)
    const rightTime = right.submittedAt == null ? 0 : Date.parse(right.submittedAt)
    return rightTime - leftTime
  })[0] ?? null
}

function collectWarningFindings(
  reviews: Array<ReviewResult & { submittedAt: string | null }>,
  threads: RawReviewThread[],
): string[] {
  const reviewFindings = reviews
    .filter((review) => review.status === 'commented')
    .flatMap((review) => review.findings.map((finding) => `${review.reviewer}: ${finding}`))
  const threadFindings = threads
    .filter((thread) => thread.isResolved !== true)
    .flatMap((thread) => describeThreadFindings(thread))
  return uniqueStrings([...reviewFindings, ...threadFindings])
}

function summarizeWarningReviewers(
  reviews: Array<ReviewResult & { submittedAt: string | null }>,
  threads: RawReviewThread[],
): string {
  const reviewers = reviews
    .filter((review) => review.status === 'commented' && review.findings.length > 0)
    .map((review) => review.reviewer)
  for (const thread of threads) {
    if (thread.isResolved === true) continue
    const firstComment = asNodes<RawThreadComment>(thread.comments)[0]
    if (firstComment != null) reviewers.push(getReviewer(firstComment.author))
  }
  return summarizeReviewers(reviewers)
}

function summarizeReviewers(reviewers: string[]): string {
  const unique = uniqueStrings(reviewers)
  if (unique.length === 0) return 'unknown'
  if (unique.length === 1) return unique[0]!
  return 'multiple'
}

function describeThreadFindings(thread: RawReviewThread): string[] {
  const firstComment = asNodes<RawThreadComment>(thread.comments)[0]
  const suffix = thread.isOutdated === true ? ' (outdated)' : ''
  const location = `${thread.path ?? 'unknown-file'}${typeof thread.line === 'number' ? `:${thread.line}` : ''}${suffix}`
  const findings = getFindings(firstComment?.body)
  if (findings.length === 0) return [`${location} - unresolved review thread`]

  const reviewer = firstComment == null ? 'unknown' : getReviewer(firstComment.author)
  return findings.map((finding) => `${location} - ${reviewer}: ${finding}`)
}

function getReviewer(author: RawReview['author'] | RawThreadComment['author']): string {
  if (typeof author === 'string') return author
  return author?.login ?? 'unknown'
}

function getFindings(body: string | null | undefined): string[] {
  return (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
