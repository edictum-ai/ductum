import type { CodeReviewVerdict } from './post-completion.js'
import { parseStructuredReviewContract, isStructuredReviewContract } from './structured-review-contract.js'
import type { BestOfNPolicy, Task } from './types.js'

export type FinalBakeoffOutcome = 'accepted' | 'accepted-with-fixes' | 'rejected'

export interface BestOfNVerdictScore {
  taskId: string
  passed: boolean
  confidence?: number
  notes?: string
}

export interface BestOfNVerdict {
  kind: 'best-of-n-verdict'
  winnerTaskId: string
  scores: BestOfNVerdictScore[]
  policy: BestOfNPolicy
  reason: string
}

export interface BakeoffWinnerResolution {
  task: Task | null
  reason: string | null
  verdict: BestOfNVerdict | null
}

export function resolveBakeoffWinner(
  feedback: string,
  candidates: readonly Task[],
  evidencePayloads: readonly unknown[] = [],
): BakeoffWinnerResolution {
  const verdictResult = parseBestOfNVerdict(feedback)
  const fallback = evidencePayloads.find(isStructuredContractWithBestOfN) ?? null
  if (verdictResult.verdict == null && fallback != null) {
    return { task: null, reason: 'blind review completion is malformed; structured verdict evidence cannot override a missing ductum-review-result contract', verdict: null }
  }
  if (verdictResult.verdict == null) {
    return { task: null, reason: verdictResult.reason, verdict: null }
  }
  return resolveVerdict(verdictResult.verdict, candidates)
}

function resolveVerdict(verdict: BestOfNVerdict, candidates: readonly Task[]): BakeoffWinnerResolution {
  const task = candidates.find((candidate) => candidate.id === verdict.winnerTaskId) ?? null
  if (task == null) {
    return {
      task: null,
      reason: `structured verdict winnerTaskId is not a known candidate: ${verdict.winnerTaskId}`,
      verdict,
    }
  }
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const unknownScore = verdict.scores.find((score) => !candidateIds.has(score.taskId as Task['id']))
  if (unknownScore != null) {
    return {
      task: null,
      reason: `structured verdict score taskId is not a known candidate: ${unknownScore.taskId}`,
      verdict,
    }
  }
  const winnerScore = verdict.scores.find((score) => score.taskId === task.id)
  if (winnerScore == null) {
    return {
      task: null,
      reason: `structured verdict winnerTaskId has no score: ${task.id}`,
      verdict,
    }
  }
  if (!winnerScore.passed) {
    return {
      task: null,
      reason: `structured verdict winner is not eligible: ${task.name}`,
      verdict,
    }
  }
  return { task, reason: null, verdict }
}

export function bakeoffWinnerOutcome(verdict: Exclude<CodeReviewVerdict, 'fail'>): FinalBakeoffOutcome {
  return verdict === 'pass' ? 'accepted' : 'accepted-with-fixes'
}

export function parseBestOfNVerdict(feedback: string): { verdict: BestOfNVerdict | null; reason: string | null } {
  const parsed = parseStructuredReviewContract(feedback)
  if (parsed.contract == null) return { verdict: null, reason: parsed.reason }
  if (parsed.contract.bestOfN == null) return { verdict: null, reason: 'ductum-review-result is missing bestOfN judge verdict' }
  return { verdict: { kind: 'best-of-n-verdict', ...parsed.contract.bestOfN }, reason: null }
}

function isStructuredContractWithBestOfN(value: unknown): value is { bestOfN: unknown } {
  return isStructuredReviewContract(value) && value.bestOfN != null
}
