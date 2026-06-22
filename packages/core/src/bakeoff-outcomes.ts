import type { CodeReviewVerdict } from './post-completion.js'
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
  const fallback = evidencePayloads.find(isBestOfNVerdict) ?? null
  if (verdictResult.verdict == null && fallback != null) {
    return resolveVerdict(fallback, candidates)
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
  const candidates = extractJsonObjects(feedback)
    .map(parseJson)
    .filter((value): value is unknown => value != null)
    .filter(isBestOfNVerdict)
  if (candidates.length === 0) {
    return { verdict: null, reason: 'blind review requires a structured best-of-n-verdict JSON block' }
  }
  const winners = new Set(candidates.map((candidate) => candidate.winnerTaskId))
  if (winners.size > 1) {
    return { verdict: null, reason: 'blind review emitted multiple conflicting structured winners' }
  }
  return { verdict: candidates[0] ?? null, reason: null }
}

function extractJsonObjects(text: string): string[] {
  return [...extractFencedJson(text), ...extractBalancedObjects(text)]
}

function extractFencedJson(text: string): string[] {
  const blocks: string[] = []
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) != null) {
    const block = match[1]?.trim()
    if (block != null && block !== '') blocks.push(block)
  }
  return blocks
}

function extractBalancedObjects(text: string): string[] {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (char !== '}') continue
    depth -= 1
    if (depth === 0 && start >= 0) {
      objects.push(text.slice(start, i + 1))
      start = -1
    }
  }
  return objects
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isBestOfNVerdict(value: unknown): value is BestOfNVerdict {
  if (value == null || typeof value !== 'object') return false
  const record = value as Partial<BestOfNVerdict>
  return record.kind === 'best-of-n-verdict'
    && typeof record.winnerTaskId === 'string'
    && record.winnerTaskId.trim() !== ''
    && Array.isArray(record.scores)
    && record.scores.every(isVerdictScore)
    && (record.policy === 'quality-gated-cost-aware' || record.policy === 'cheapest-verified-reviewed')
    && typeof record.reason === 'string'
    && record.reason.trim() !== ''
    && !Object.prototype.hasOwnProperty.call(record, 'override')
}

function isVerdictScore(value: unknown): value is BestOfNVerdictScore {
  if (value == null || typeof value !== 'object') return false
  const record = value as Partial<BestOfNVerdictScore>
  return typeof record.taskId === 'string'
    && record.taskId.trim() !== ''
    && typeof record.passed === 'boolean'
    && !Object.prototype.hasOwnProperty.call(record, 'costUsd')
    && (record.confidence == null || (typeof record.confidence === 'number' && record.confidence >= 0 && record.confidence <= 1))
    && (record.notes == null || typeof record.notes === 'string')
}
