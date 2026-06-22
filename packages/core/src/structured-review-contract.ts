import type { BestOfNPolicy } from './types.js'

export type StructuredReviewVerdict = 'pass' | 'warn' | 'fail'

export interface StructuredReviewScore {
  taskId: string
  passed: boolean
  confidence?: number
  notes?: string
}

export interface StructuredBestOfNVerdict {
  winnerTaskId: string
  scores: StructuredReviewScore[]
  policy: BestOfNPolicy
  reason: string
}

export interface StructuredReviewContract {
  kind: 'ductum-review-result'
  verdict: StructuredReviewVerdict
  summary: string
  findings: string[]
  bestOfN?: StructuredBestOfNVerdict
}

export interface StructuredReviewParseResult {
  contract: StructuredReviewContract | null
  reason: string | null
}

interface FencedJsonBlock {
  content: string
  start: number
  end: number
}

export const STRUCTURED_REVIEW_CONTRACT_RULE = [
  'Emit exactly one JSON object and no alternate verdicts:',
  '{',
  '  "kind": "ductum-review-result",',
  '  "verdict": "pass|warn|fail",',
  '  "summary": "one-line operator summary",',
  '  "findings": ["specific finding or empty for clean pass"],',
  '  "bestOfN": { "winnerTaskId": "<candidate task id>", "scores": [{ "taskId": "<candidate task id>", "passed": true, "confidence": 0.86, "notes": "short notes" }], "policy": "quality-gated-cost-aware|cheapest-verified-reviewed", "reason": "why this candidate is best" }',
  '}',
  'Omit bestOfN for ordinary code reviews. Prose-only PASS/WARN/FAIL is malformed.',
].join('\n')

export function parseStructuredReviewContract(text: string): StructuredReviewParseResult {
  if (text.trim() === '') return { contract: null, reason: 'empty result' }
  const parsed = extractJsonObjects(text).map(parseJson).filter((value): value is unknown => value != null)
  const contracts = parsed.filter(isStructuredReviewContract)
  if (contracts.length === 0) return { contract: null, reason: 'requires exactly one structured ductum-review-result JSON object' }
  if (contracts.length > 1) return { contract: null, reason: 'multiple structured ductum-review-result JSON objects' }
  return { contract: contracts[0] ?? null, reason: null }
}

function extractJsonObjects(text: string): string[] {
  const fenced = extractFencedJson(text)
  return [
    ...fenced.map((block) => block.content),
    ...extractBalancedObjects(text, fenced),
  ]
}

function extractFencedJson(text: string): FencedJsonBlock[] {
  const blocks: FencedJsonBlock[] = []
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) != null) {
    const block = match[1]?.trim()
    if (block != null && block !== '') blocks.push({ content: block, start: match.index, end: pattern.lastIndex })
  }
  return blocks
}

function extractBalancedObjects(text: string, ignoredRanges: readonly Pick<FencedJsonBlock, 'start' | 'end'>[]): string[] {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    if (ignoredRanges.some((range) => i >= range.start && i < range.end)) continue
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') { if (depth === 0) start = i; depth += 1; continue }
    if (char !== '}') continue
    depth -= 1
    if (depth === 0 && start >= 0) { objects.push(text.slice(start, i + 1)); start = -1 }
  }
  return objects
}

function parseJson(value: string): unknown | null {
  try { return JSON.parse(value) as unknown } catch { return null }
}

export function isStructuredReviewContract(value: unknown): value is StructuredReviewContract {
  if (value == null || typeof value !== 'object') return false
  const record = value as Partial<StructuredReviewContract> & Record<string, unknown>
  return record.kind === 'ductum-review-result'
    && (record.verdict === 'pass' || record.verdict === 'warn' || record.verdict === 'fail')
    && typeof record.summary === 'string'
    && record.summary.trim() !== ''
    && Array.isArray(record.findings)
    && record.findings.every((item) => typeof item === 'string')
    && (record.bestOfN == null || isStructuredBestOfN(record.bestOfN))
    && !Object.prototype.hasOwnProperty.call(record, 'override')
}

function isStructuredBestOfN(value: unknown): value is StructuredBestOfNVerdict {
  if (value == null || typeof value !== 'object') return false
  const record = value as Partial<StructuredBestOfNVerdict> & Record<string, unknown>
  return typeof record.winnerTaskId === 'string'
    && record.winnerTaskId.trim() !== ''
    && Array.isArray(record.scores)
    && record.scores.length > 0
    && record.scores.every(isStructuredScore)
    && (record.policy === 'quality-gated-cost-aware' || record.policy === 'cheapest-verified-reviewed')
    && typeof record.reason === 'string'
    && record.reason.trim() !== ''
    && !Object.prototype.hasOwnProperty.call(record, 'override')
}

function isStructuredScore(value: unknown): value is StructuredReviewScore {
  if (value == null || typeof value !== 'object') return false
  const record = value as Partial<StructuredReviewScore> & Record<string, unknown>
  return typeof record.taskId === 'string'
    && record.taskId.trim() !== ''
    && typeof record.passed === 'boolean'
    && !Object.prototype.hasOwnProperty.call(record, 'costUsd')
    && (record.confidence == null || (typeof record.confidence === 'number' && record.confidence >= 0 && record.confidence <= 1))
    && (record.notes == null || typeof record.notes === 'string')
}
