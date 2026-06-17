import type { Spec, Task } from '@ductum/core'
import type { ImportedSpec } from './spec-import-types.js'

export interface PromptContractAudit {
  label: string
  decisionTrace: boolean
  verification: boolean
  driftHandling: boolean
  behaviorContract: {
    status: 'ok' | 'missing' | 'weak'
    reasons: string[]
  }
  slopReview: {
    status: 'ok' | 'missing' | 'weak'
    reasons: string[]
  }
}

export interface SpecContractReport {
  audits: PromptContractAudit[]
  warnings: string[]
  incomplete: boolean
  markdown: string
}

const BEHAVIOR_SUBJECT_WORDS = /\b(agent|api|audit|auth|authorization|cli|config|decision|dispatch|dispatcher|drift|evidence|field|gate|harness|id|ids|import|input|memoryid|migration|namespace|operator|output|project|prompt|provenance|resource|run|runtime|schema|scope|scoped|session|slop[ -]review|spec|supersedes|target|task|test|tests|tool|tools|transaction|umzug|verification|watcher|yaml)\b/i
const FAILURE_OR_RUNTIME_WORDS = /\b(must not|forbidden|reject(?:s|ed|ing)?|den(?:y|ies|ied|ying)|fail(?:s|ed|ing|ure)?|error(?:s|ed)?|visible|preserv(?:e|es|ed|ing)|swallow(?:s|ed|ing)?|loud|invalid|missing|refus(?:e|es|ed|ing)|operator-visible|runtime|silently|round-trip|scop(?:e|es|ed|ing)|resolv(?:e|es|ed|ing)|dispatch(?:es|ed|ing)?|block(?:s|ed|ing)?|audit(?:s|ed|ing)?)\b/i
const SLOP_REVIEW_WORDS = /\b(behavior contract|behavioral tests?|explicit evidence|loud failures?|swallow(?:s|ed|ing)?|duplicates?|resolution logic|routing logic|abstraction|dead config|future features|missing or invalid inputs|scope creep|runtime behavior|failure modes?|provenance|authorization|namespace)\b/i
const NON_GOAL_ONLY = /\b(must not|no|forbidden)\b.*\b(automatic proof|automatically prove|dependency|dependencies|formal graph|graph analyzer|policy engine|second policy|table|top-level|primitive)\b/i
const NON_GOAL_CHECKLIST_ONLY = /\b(policy engine|second policy|graph analyzer|top-level primitive|new table|new dependency)\b/i

export function buildSpecContractReport(input: {
  spec: Pick<Spec, 'name' | 'document'>
  tasks: Array<Pick<Task, 'name' | 'prompt'> & { id?: Task['id'] }>
}): SpecContractReport {
  const audits = [
    auditPromptContract(`Spec ${input.spec.name}`, input.spec.document),
    ...input.tasks.map((task) => auditPromptContract(task.id == null ? `Task ${task.name}` : `Task ${task.name} (${task.id})`, task.prompt)),
  ]
  const warnings = audits.flatMap((audit) => auditWarnings(audit))
  const incomplete = audits.some(isIncompleteAudit)
  return {
    audits,
    warnings,
    incomplete,
    markdown: formatContractReportMarkdown(audits, incomplete),
  }
}

export function buildImportedSpecContractReport(input: ImportedSpec): SpecContractReport {
  return buildSpecContractReport({
    spec: {
      name: input.spec.name,
      document: input.spec.document ?? '',
    },
    tasks: input.tasks.map((task) => ({
      name: task.name,
      prompt: task.prompt,
    })),
  })
}

function auditPromptContract(label: string, markdown: string): PromptContractAudit {
  const behavior = classifyBehaviorContract(markdown)
  const slopReview = classifyChecklistSection(markdown, 'Slop Review', SLOP_REVIEW_WORDS)
  return {
    label,
    decisionTrace: hasDecisionTrace(markdown),
    verification: hasVerification(markdown),
    driftHandling: hasDriftHandling(markdown),
    behaviorContract: behavior,
    slopReview,
  }
}

export function hasDecisionTrace(markdown: string): boolean {
  return hasSectionBody(markdown, ['Decision Trace'])
    || hasLineOutsideCode(markdown, /\bDecision Trace\s*:\s*\S/i)
}

function hasVerification(markdown: string): boolean {
  return hasSectionBody(markdown, ['Verification'])
    || hasLineOutsideCode(markdown, /^\s*-\s*Verification\s*:\s*\S/i)
}

function hasDriftHandling(markdown: string): boolean {
  return hasSectionBody(markdown, ['Drift Handling', 'Drift'])
    || hasLineOutsideCode(markdown, /^\s*-\s*Drift handling\s*:\s*\S/i)
}

function classifyBehaviorContract(markdown: string): PromptContractAudit['behaviorContract'] {
  const body = extractSection(markdown, 'Behavior Contract')
  if (body == null) return { status: 'missing', reasons: ['section is absent'] }
  const items = checklistItems(body)
  if (items.length === 0) {
    return { status: 'weak', reasons: ['section has no checklist items'] }
  }
  const behavioralItems = items.filter(isBehavioralItem)
  if (behavioralItems.length === 0) {
    return {
      status: 'weak',
      reasons: [
        'items do not describe failure modes, runtime behavior, or evidence paths',
        weakBehaviorItemReason(items),
      ],
    }
  }
  const requiredBehavioralItems = Math.max(2, Math.ceil(items.length * 2 / 3))
  if (behavioralItems.length < requiredBehavioralItems) {
    return {
      status: 'weak',
      reasons: [
        `needs at least ${requiredBehavioralItems} behavioral items with failure modes, runtime behavior, or evidence paths`,
        weakBehaviorItemReason(items.filter((item) => !isBehavioralItem(item))),
      ],
    }
  }
  return { status: 'ok', reasons: [] }
}

function isBehavioralItem(item: string): boolean {
  if (NON_GOAL_ONLY.test(item)) return false
  return FAILURE_OR_RUNTIME_WORDS.test(item)
    && BEHAVIOR_SUBJECT_WORDS.test(item)
}

function weakBehaviorItemReason(items: string[]): string {
  const reasons = items.slice(0, 3).map((item) => {
    if (NON_GOAL_ONLY.test(item)) return `non-goal-only: ${preview(item)}`
    const missing = [
      FAILURE_OR_RUNTIME_WORDS.test(item) ? null : 'failure/runtime word',
      BEHAVIOR_SUBJECT_WORDS.test(item) ? null : 'behavior subject',
    ].filter((word): word is string => word != null)
    return `${missing.join(' + ') || 'unmatched'}: ${preview(item)}`
  })
  return `weak items: ${reasons.join('; ')}. Example: "- Runtime must reject invalid input; evidence: pnpm test."`
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function classifyChecklistSection(
  markdown: string,
  heading: string,
  strength: RegExp,
): { status: 'ok' | 'missing' | 'weak'; reasons: string[] } {
  const body = extractSection(markdown, heading)
  if (body == null) return { status: 'missing', reasons: ['section is absent'] }
  const items = checklistItems(body)
  if (items.length === 0) return { status: 'weak', reasons: ['section has no checklist items'] }
  const strongItems = items.filter((item) => strength.test(item) && !NON_GOAL_CHECKLIST_ONLY.test(item))
  if (strongItems.length < 2) {
    return { status: 'weak', reasons: ['items do not ask reviewers to test behavior or attack slop'] }
  }
  return { status: 'ok', reasons: [] }
}

function sectionWarnings(audit: PromptContractAudit): string[] {
  const warnings: string[] = []
  if (!audit.decisionTrace) warnings.push(`${audit.label} is missing a Decision Trace.`)
  if (!audit.verification) warnings.push(`${audit.label} is missing Verification.`)
  if (!audit.driftHandling) warnings.push(`${audit.label} is missing Drift handling.`)
  if (audit.slopReview.status === 'missing') warnings.push(`${audit.label} is missing Slop Review.`)
  return warnings
}

function formatContractReportMarkdown(audits: PromptContractAudit[], incomplete: boolean): string {
  const rows = audits.map((audit) => [
    audit.label,
    mark(audit.decisionTrace),
    audit.behaviorContract.status,
    mark(audit.verification),
    mark(audit.driftHandling),
    audit.slopReview.status,
  ])
  return [
    '# Spec Contract Coverage',
    '',
    `Status: ${incomplete ? 'incomplete' : 'complete'}`,
    '',
    'Heuristic: this checks markdown coverage only; reviewers must still prove each behavior item with tests or evidence.',
    '',
    '| Artifact | Decision Trace | Behavior Contract | Verification | Drift Handling | Slop Review |',
    '|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.map(escapeTableCell).join(' | ')} |`),
  ].join('\n')
}

function hasSectionBody(markdown: string, headings: string[]): boolean {
  return headings.some((heading) => (extractSection(markdown, heading)?.trim() ?? '') !== '')
}

function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const body: string[] = []
  let fenceMarker: string | null = null
  let foundLevel: number | null = null
  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null
    if (fence != null && (
      fenceMarker == null
        || (fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length)
    )) {
      fenceMarker = fenceMarker == null ? fence : null
    }
    const match = fenceMarker != null || /^(?: {4,}|\t)/.test(line)
      ? null
      : /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (match != null) {
      const level = match[1]?.length ?? 6
      const text = (match[2] ?? '').replace(/\s+#+\s*$/, '').trim()
      if (foundLevel == null && text.toLowerCase() === heading.toLowerCase()) {
        foundLevel = level
        continue
      }
      if (foundLevel != null && level <= foundLevel) break
    }
    if (foundLevel != null) body.push(line)
  }
  return foundLevel == null ? null : body.join('\n')
}

function hasLineOutsideCode(markdown: string, pattern: RegExp): boolean {
  let fenceMarker: string | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null
    if (fence != null && (
      fenceMarker == null
        || (fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length)
    )) {
      fenceMarker = fenceMarker == null ? fence : null
      continue
    }
    if (fenceMarker != null || /^(?: {4,}|\t)/.test(line)) continue
    if (pattern.test(line)) return true
  }
  return false
}

function auditWarnings(audit: PromptContractAudit): string[] {
  const warnings = sectionWarnings(audit)
  if (audit.behaviorContract.status === 'missing') {
    warnings.push(`${audit.label} is missing a Behavior Contract.`)
  } else if (audit.behaviorContract.status === 'weak') {
    warnings.push(`${audit.label} has a weak Behavior Contract: ${audit.behaviorContract.reasons.join('; ')}.`)
  }
  if (audit.slopReview.status === 'weak') {
    warnings.push(`${audit.label} has a weak Slop Review: ${audit.slopReview.reasons.join('; ')}.`)
  }
  return warnings
}

function isIncompleteAudit(audit: PromptContractAudit): boolean {
  return !audit.decisionTrace
    || !audit.verification
    || !audit.driftHandling
    || audit.behaviorContract.status !== 'ok'
    || audit.slopReview.status !== 'ok'
}

function checklistItems(body: string): string[] {
  const items: string[] = []
  let current = -1
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^[-*]\s+\S/.test(trimmed) || /^\d+\.\s+\S/.test(trimmed)) {
      items.push(trimmed)
      current = items.length - 1
    } else if (current >= 0 && /^(?:\s{2,}|\t)\S/.test(line)) {
      items[current] = `${items[current]} ${trimmed}`
    } else if (trimmed === '') {
      current = -1
    }
  }
  return items
}

function mark(value: boolean): string {
  return value ? 'ok' : 'missing'
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\s+/g, ' ').trim()
}
