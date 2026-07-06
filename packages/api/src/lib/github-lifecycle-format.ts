import { sanitizeGeneratedGitTitle, type Evidence, type GitHubIssueSource, type Run, type Spec, type Task } from '@ductum/core'

export function conventionalTypeForSource(spec: Spec, task: Task): string {
  const source = resolveGitHubIssueSource(spec, task)
  const workType = source != null && 'parsed' in source ? source.parsed.workType : ''
  switch (workType) {
    case 'bug':
    case 'security':
      return 'fix'
    case 'docs':
      return 'docs'
    case 'cleanup':
    case 'migration':
    case 'distribution':
      return 'chore'
    default:
      return 'feat'
  }
}

export function resolveConventionalBranchName(spec: Spec, task: Task, repositoryBranchPrefix?: string): string {
  const source = resolveGitHubIssueSource(spec, task)
  const suggested = source != null && 'parsed' in source ? source.parsed.suggestedBranch : null
  if (suggested != null && suggested.trim() !== '') return suggested.trim()
  const prefix = cleanBranchPrefix(repositoryBranchPrefix) ?? `${conventionalTypeForSource(spec, task)}/`
  return `${prefix}${sanitizeGitRefSegment(task.name)}`
}

export function buildConventionalPrTitle(spec: Spec, task: Task): string {
  const source = resolveGitHubIssueSource(spec, task)
  const titleSource = sanitizeGeneratedGitTitle(source?.title ?? task.name)
  return `${conventionalTypeForSource(spec, task)}: ${titleSource}`
}

export function buildGitHubPrBody(input: {
  spec: Spec
  task: Task
  run: Run
  branch: string
  evidence: Evidence[]
}): string {
  const source = resolveGitHubIssueSource(input.spec, input.task)
  const verificationStatus = describeVerification(input.task, input.evidence)
  return [
    '## Summary',
    source == null ? `- Task: ${input.task.name}` : `- Source issue: ${source.issueUrl} (${source.repoOwner}/${source.repoName}#${source.issueNumber})`,
    `- Branch: ${input.branch}`,
    '',
    '## Verification',
    ...verificationStatus.local.map((line) => `- ${line}`),
    ...(verificationStatus.ci.length === 0 ? [] : [
      '',
      '## CI',
      ...verificationStatus.ci.map((line) => `- ${line}`),
    ]),
    '',
    '## Approval',
    `- Operator approval: ${input.run.pendingApproval ? 'pending' : 'not yet open'}`,
    `- Linked PR provenance: ${input.run.prUrl == null ? 'creating or updating now' : input.run.prUrl}`,
    ...(source == null || !('promptImport' in source) ? [] : [
      '',
      '## Prompt import',
      `- Prompt digest: ${source.promptImport.promptDigest}`,
      `- Implementation prompt source: ${source.promptImport.implementation.sourceUrl}`,
      `- Review prompt source: ${source.promptImport.review.sourceUrl}`,
    ]),
    ...(source == null || !('parsed' in source) ? [] : [
      '',
      '## Evidence',
      ...source.parsed.evidence.map((line: string) => `- ${line}`),
    ]),
  ].join('\n')
}

export function buildGitHubIssueCompletionComment(input: {
  spec: Spec
  task: Task
  run: Run
  branch: string
  commitSha: string
  prNumber: number
  prUrl: string
  evidence: Evidence[]
}): string | null {
  const source = resolveGitHubIssueSource(input.spec, input.task)
  if (source == null) return null
  const verificationStatus = describeVerification(input.task, input.evidence)
  return [
    'Ductum imported this issue and opened or updated the linked PR.',
    '',
    `- Branch: \`${input.branch}\``,
    `- Commit: \`${input.commitSha}\``,
    `- PR: #${input.prNumber} ${input.prUrl}`,
    ...verificationStatus.local.map((line) => `- Verification: ${line}`),
    ...verificationStatus.ci.map((line) => `- CI: ${line}`),
    '',
    'Operator approval and issue closure remain explicit policy decisions.',
  ].join('\n')
}

export function resolveGitHubIssueSource(spec: Spec, task: Task): GitHubIssueSource | null {
  if (task.source?.kind === 'github-issue') return task.source
  if (spec.source?.kind === 'github-issue') return spec.source
  return null
}

interface VerificationItem {
  command: string | null
  state: 'passed' | 'failed' | 'blocked' | 'unavailable'
  detail: string | null
}

function describeVerification(task: Task, evidence: Evidence[]): { local: string[]; ci: string[] } {
  const localItems = evidence.flatMap(extractVerificationItems)
  const genericItems = [...localItems.filter((item) => item.command == null)]
  // When the task carries no verification commands, fall back to the runtime
  // verification evidence (kind: 'verify', worktree.snapshot, etc.) so PR
  // bodies report what actually ran instead of "No verification commands
  // recorded". Only when both task and runtime evidence are empty do we
  // surface the placeholder line.
  const runtimeCommands = task.verification.length === 0 ? uniqueRuntimeCommands(localItems) : []
  const commands = task.verification.length > 0
    ? task.verification
    : runtimeCommands.length > 0
      ? runtimeCommands
      : ['No verification commands recorded']
  const isPlaceholder = commands.length === 1 && commands[0] === 'No verification commands recorded'
  const local = commands.map((command) => {
    if (isPlaceholder) return command
    const matchIndex = localItems.findIndex((item) => sameCommand(item.command, command))
    const match = matchIndex >= 0 ? (localItems[matchIndex] ?? null) : (genericItems.shift() ?? null)
    return `${command} ${formatVerificationState(match)}`
  })
  return { local, ci: describeCiEvidence(evidence) }
}

function uniqueRuntimeCommands(items: VerificationItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (item.command == null || item.command.trim() === '') continue
    if (isRuntimeCommandPlaceholder(item.command)) continue
    const normalized = normalizeCommand(item.command)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(item.command)
  }
  return out
}

function isRuntimeCommandPlaceholder(command: string): boolean {
  return normalizeCommand(command) === '(none)'
}

function extractVerificationItems(evidence: Evidence): VerificationItem[] {
  if (evidence.type === 'ci') return []
  if (evidence.type === 'test' || evidence.type === 'lint') return collectVerificationItems(evidence.payload)
  if (evidence.type !== 'custom') return []
  if (evidence.payload.kind === 'worktree.snapshot') {
    const verifyOutput = asRecord(evidence.payload.verifyOutput)
    const command = readString(verifyOutput?.command)
    const exitCode = typeof verifyOutput?.exitCode === 'number' ? verifyOutput.exitCode : null
    return exitCode == null ? [] : [{
      command,
      state: exitCode === 0 ? 'passed' : 'failed',
      detail: exitCode === 0 ? null : compactDetail(readString(verifyOutput?.tail)),
    }]
  }
  if (evidence.payload.kind !== 'verify') return []
  return collectVerificationItems(evidence.payload)
}

function collectVerificationItems(payload: Record<string, unknown>): VerificationItem[] {
  const listEntries = [payload.commands, payload.results, payload.items]
    .filter(Array.isArray)
    .flatMap((value) => value)
    .map((value) => parseVerificationItem(value))
    .filter((value): value is VerificationItem => value != null)
  if (listEntries.length > 0) return listEntries
  const single = parseVerificationItem(payload)
  return single == null ? [] : [single]
}

function parseVerificationItem(value: unknown): VerificationItem | null {
  const record = asRecord(value)
  if (record == null) return null
  const state = readVerificationState(record)
  if (state == null) return null
  return {
    command: readString(record.command) ?? readString(record.name) ?? readString(record.label) ?? null,
    state,
    detail: readVerificationDetail(record),
  }
}

function readVerificationState(record: Record<string, unknown>): VerificationItem['state'] | null {
  const status = readString(record.status)?.toLowerCase()
  if (status === 'pass' || status === 'passed' || status === 'success' || status === 'ok') return 'passed'
  if (status === 'fail' || status === 'failed' || status === 'error') return 'failed'
  if (status === 'blocked') return 'blocked'
  if (status === 'unavailable' || status === 'skipped') return 'unavailable'
  if (typeof record.passed === 'boolean') return record.passed ? 'passed' : inferFailureState(record)
  if (typeof record.exitCode === 'number') return record.exitCode === 0 ? 'passed' : 'failed'
  const detail = [record.reason, record.summary, record.output, record.message].map(readString).find((value) => value != null)?.toLowerCase()
  if (detail?.includes('blocked')) return 'blocked'
  if (detail?.includes('unavailable')) return 'unavailable'
  return null
}

function inferFailureState(record: Record<string, unknown>): VerificationItem['state'] {
  const detail = [record.reason, record.summary, record.output, record.message].map(readString).find((value) => value != null)?.toLowerCase()
  if (detail?.includes('blocked')) return 'blocked'
  if (detail?.includes('unavailable')) return 'unavailable'
  return 'failed'
}

function readVerificationDetail(record: Record<string, unknown>): string | null {
  return compactDetail(
    readString(record.detail)
    ?? readString(record.reason)
    ?? readString(record.summary)
    ?? readString(record.message)
    ?? readString(record.output)
    ?? readString(record.tail),
  )
}

function describeCiEvidence(evidence: Evidence[]): string[] {
  const latest = evidence.filter((item) => item.type === 'ci').at(-1)
  if (latest == null) return []
  const commitSha = readString(latest.payload.commitSha) ?? readString(latest.payload.commit) ?? 'unknown commit'
  const checks = Array.isArray(latest.payload.checks)
    ? latest.payload.checks
      .map((check) => readString(asRecord(check)?.name))
      .filter((name): name is string => name != null)
    : []
  const status = latest.payload.passed === true ? 'passed' : latest.payload.passed === false ? 'failed' : 'reported'
  const suffix = checks.length === 0 ? status : `${status}: ${checks.join(', ')}`
  return [`commit \`${commitSha}\` (${suffix})`]
}

function formatVerificationState(item: VerificationItem | null): string {
  if (item == null) return '(unavailable: no matching evidence recorded)'
  if (item.state === 'passed') return '(passed)'
  return item.detail == null ? `(${item.state})` : `(${item.state}: ${item.detail})`
}

function sameCommand(left: string | null, right: string): boolean {
  return normalizeCommand(left) === normalizeCommand(right)
}

function normalizeCommand(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function compactDetail(value: string | null | undefined): string | null {
  if (value == null) return null
  const line = value.trim().split('\n')[0]?.trim() ?? ''
  return line === '' ? null : line.slice(0, 140)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function cleanBranchPrefix(value: string | undefined): string | undefined {
  if (value == null) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function sanitizeGitRefSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task'
}
