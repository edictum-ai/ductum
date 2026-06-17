import { Link } from 'react-router-dom'

import type { ExecutionIntegrityIssueSample, ExecutionMode } from '@/api/client'
import { Mono, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import { executionIssueLabel, executionModeLabel } from '@/lib/execution-integrity'

type IssueTone = 'current' | 'history'

const historicalStatuses = new Set(['done', 'cancelled'])
const urgentStatuses = new Set(['blocked', 'failed', 'stalled'])

export function orderIntegrityIssues(issues: ExecutionIntegrityIssueSample[]): ExecutionIntegrityIssueSample[] {
  return [...issues].sort((a, b) => {
    const byPriority = issuePriority(a) - issuePriority(b)
    if (byPriority !== 0) return byPriority
    return issueSortText(a).localeCompare(issueSortText(b))
  })
}

export function IntegrityIssueList({
  issues,
  divided = false,
}: {
  issues: ExecutionIntegrityIssueSample[]
  divided?: boolean
}) {
  return (
    <div style={{ display: 'grid', gap: divided ? 0 : 10 }}>
      {orderIntegrityIssues(issues).map((issue) => (
        <IntegrityIssueRow
          key={`${issue.scope}:${issue.id}:${issue.issueCode}`}
          issue={issue}
          divided={divided}
        />
      ))}
    </div>
  )
}

function IntegrityIssueRow({
  issue,
  divided,
}: {
  issue: ExecutionIntegrityIssueSample
  divided: boolean
}) {
  const tone = issueTone(issue)
  const color = tone === 'current' ? tokens.err : tokens.warn
  const meta = issueMeta(issue)

  return (
    <Link
      to={issueHref(issue)}
      title={executionIssueLabel(issue.issueCode)}
      style={{
        display: 'block',
        border: divided ? 0 : `1px solid ${tokens.hair}`,
        borderTop: divided ? `1px solid ${tokens.hair}` : undefined,
        borderRadius: divided ? 0 : 8,
        padding: divided ? '12px 0 0' : '12px 14px',
        background: divided ? 'transparent' : tokens.sunken,
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {executionIssueLabel(issue.issueCode)}
        </span>
        <ProjectPill projectName={issue.projectName} />
      </div>
      <div style={{ marginTop: 7, fontSize: 13, color: tokens.strong, fontWeight: 500 }}>
        {issue.specName} · {issue.taskName}
      </div>
      <Mono size={11} color={modeColor(issue.executionMode)} style={{ display: 'block', marginTop: 6 }}>
        {meta}
      </Mono>
    </Link>
  )
}

function ProjectPill({ projectName }: { projectName: string }) {
  return (
    <span
      style={{
        border: `1px solid ${tokens.hair}`,
        borderRadius: 999,
        color: tokens.mid,
        fontFamily: tokens.mono,
        fontSize: 10,
        lineHeight: 1.5,
        padding: '0 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {projectName}
    </span>
  )
}

function issuePriority(issue: ExecutionIntegrityIssueSample): number {
  const status = issue.status.toLowerCase()
  if (urgentStatuses.has(status)) return 0
  if (historicalStatuses.has(status)) return 2
  return 1
}

function issueTone(issue: ExecutionIntegrityIssueSample): IssueTone {
  return historicalStatuses.has(issue.status.toLowerCase()) ? 'history' : 'current'
}

function issueMeta(issue: ExecutionIntegrityIssueSample): string {
  const status = historicalStatuses.has(issue.status.toLowerCase())
    ? `historical ${issue.status}`
    : issue.status
  const scope = issue.scope === 'run' ? 'Attempt' : 'Task'
  return `${scope} · ${executionModeLabel(issue.executionMode)} · ${statusLabel(status)}`
}

function issueHref(issue: ExecutionIntegrityIssueSample): string {
  const base = `/${enc(issue.projectName)}/${enc(issue.specName)}/${enc(issue.taskName)}`
  const runId = issue.runId ?? (issue.scope === 'run' ? issue.id : null)
  return runId != null ? `${base}/${enc(shortId(runId))}` : base
}

function issueSortText(issue: ExecutionIntegrityIssueSample): string {
  return [
    issue.projectName,
    issue.specName,
    issue.taskName,
    issue.scope,
    issue.issueCode,
  ].join('\u0000')
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

function modeColor(mode: ExecutionMode): string {
  switch (mode) {
    case 'orchestrated': return tokens.ok
    case 'external': return tokens.info
    case 'recorded': return tokens.warn
    case 'inconsistent': return tokens.warn
    default: return tokens.mid
  }
}

function statusLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
