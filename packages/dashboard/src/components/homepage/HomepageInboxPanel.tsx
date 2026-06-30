import type { EnrichedRun } from '@/api/client'
import { Link } from 'react-router-dom'

import { Caps, Card, Dot, Mono, tokens } from '@/components/signal'
import { executionIssueLabel } from '@/lib/execution-integrity'
import { displayRunTaskName, displayStoredName } from '@/lib/project-display'
import { runHref, runStatusLabel, runStatusTone } from '@/lib/run-presentation'
import { stageLabel } from '@/lib/stage-display'
import { timeAgo } from '@/lib/utils'
import { HomepageAwaitingBanner } from './HomepageAwaitingBanner'

const HOME_ATTENTION_LIMIT = 3

export function HomepageInboxPanel({
  awaitingApproval,
  needsAttention,
  reportedApprovals,
  reportedNeedsOperator,
}: {
  awaitingApproval: EnrichedRun[]
  needsAttention: EnrichedRun[]
  reportedApprovals?: number
  reportedNeedsOperator?: number
}) {
  const approvalCount = reportedApprovals ?? awaitingApproval.length
  const needsCount = reportedNeedsOperator ?? needsAttention.length
  const totalCount = approvalCount + needsCount
  const inboxHeadline = totalCount === 1 ? '1 item needs you' : `${totalCount} items need you`

  return (
    <section aria-labelledby="home-inbox-title" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div id="home-inbox-title">
            <Caps color={totalCount > 0 ? tokens.accent : tokens.mid}>Inbox</Caps>
          </div>
          <div style={{ marginTop: 6, fontSize: 22, lineHeight: 1.15, color: tokens.strong, fontWeight: 600 }}>
            {totalCount > 0 ? inboxHeadline : 'Clear'}
          </div>
        </div>
        <Mono size={12} color={totalCount > 0 ? tokens.accent : tokens.dim}>
          {approvalCount} approvals · {needsCount} failed/stalled
        </Mono>
      </div>

      {totalCount === 0 ? (
        <Card pad={16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Dot color={tokens.ok} size={7} />
            <Mono size={12} color={tokens.dim}>No operator action is waiting.</Mono>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {(needsAttention.length > 0 || needsCount > 0) && (
            <CompactNeedsAttention attempts={needsAttention} reportedCount={needsCount} />
          )}
          {awaitingApproval.map((run) => (
            <HomepageAwaitingBanner key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  )
}

function CompactNeedsAttention({
  attempts,
  reportedCount,
}: {
  attempts: EnrichedRun[]
  reportedCount: number
}) {
  const visibleAttempts = attempts.slice(0, HOME_ATTENTION_LIMIT)
  const hiddenCount = Math.max(0, reportedCount - visibleAttempts.length)

  return (
    <Card pad={0} style={{ borderColor: `color-mix(in oklab, ${tokens.err} 34%, ${tokens.hair})` }}>
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid color-mix(in oklab, ${tokens.err} 22%, ${tokens.hair})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 5 }}>
          <Caps color={tokens.err}>Failed or stalled attempts</Caps>
          <Mono size={12} color={tokens.dim}>
            Open the attempt first; retry only after logs and worktree state are inspected.
          </Mono>
        </div>
        <Link
          to="/activity"
          style={{
            color: tokens.strong,
            border: `1px solid ${tokens.rule}`,
            borderRadius: 7,
            padding: '7px 10px',
            textDecoration: 'none',
            fontFamily: tokens.mono,
            fontSize: 11,
            whiteSpace: 'nowrap',
          }}
        >
          Open Factory Activity
        </Link>
      </div>

      {visibleAttempts.length === 0 ? (
        <div style={{ padding: 16 }}>
          <Mono size={12} color={tokens.dim}>
            The operator brief reports {reportedCount} action item{reportedCount === 1 ? '' : 's'}, but this response has no row details. Open Factory Activity for the current list.
          </Mono>
        </div>
      ) : (
        <div style={{ display: 'grid' }}>
          {visibleAttempts.map((attempt) => (
            <CompactNeedsAttentionRow key={attempt.id} attempt={attempt} />
          ))}
        </div>
      )}

      {hiddenCount > 0 && (
        <Link
          to="/activity"
          style={{
            display: 'block',
            borderTop: `1px solid ${tokens.hair}`,
            padding: '11px 16px',
            color: tokens.dim,
            textDecoration: 'none',
            fontFamily: tokens.mono,
            fontSize: 11,
          }}
        >
          View all {reportedCount} action items in Factory Activity
        </Link>
      )}
    </Card>
  )
}

function CompactNeedsAttentionRow({ attempt }: { attempt: EnrichedRun }) {
  const signal = latestSignal(attempt)
  const updatedAt = attempt.lastHeartbeat ?? attempt.updatedAt
  const statusColor = statusToneColor(runStatusTone(attempt))
  const taskLabel = displayRunTaskName(attempt)
  const specLabel = displayStoredName(attempt.specName, 'Spec')

  return (
    <Link
      to={runHref(attempt)}
      aria-label={`Open attempt ${taskLabel}`}
      style={{
        display: 'grid',
        gap: 8,
        padding: '13px 16px',
        borderTop: `1px solid ${tokens.hair}`,
        color: tokens.fg,
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
        <Dot color={statusColor} size={7} />
        <Mono size={11} color={statusColor}>{runStatusLabel(attempt)}</Mono>
        <Mono size={11} color={tokens.mid}>{stageLabel(attempt.stage)}</Mono>
        <strong style={{ minWidth: 0, color: tokens.strong, fontSize: 14, lineHeight: 1.25 }}>
          {taskLabel}
        </strong>
        <Mono size={11} color={tokens.dim} style={{ marginLeft: 'auto' }}>
          {timeAgo(updatedAt)}
        </Mono>
      </div>
      <Mono size={11} color={tokens.dim} style={{ lineHeight: 1.45 }}>
        {attempt.projectName} · {specLabel} · {agentLabel(attempt)}
      </Mono>
      <Mono size={11} color={tokens.mid} style={{ lineHeight: 1.45 }}>
        {signal ?? 'No failure signal is included in this list response. Open the attempt for logs and evidence.'}
      </Mono>
    </Link>
  )
}

function latestSignal(attempt: EnrichedRun): string | null {
  const reason = compactReason(attempt.failReason ?? attempt.blockedReason)
  if (reason != null) return reason
  const issue = attempt.executionIssues?.[0]
  if (issue == null) return null
  const detail = compactReason(issue.message)
  const label = executionIssueLabel(issue.code)
  return detail == null || detail === label ? label : `${label}: ${detail}`
}

function compactReason(reason: string | null | undefined): string | null {
  const normalized = reason?.replace(/\s+/g, ' ').trim()
  if (normalized == null || normalized === '') return null
  if (normalized.length <= 150) return normalized
  return `${normalized.slice(0, 147)}...`
}

function agentLabel(attempt: EnrichedRun): string {
  if (attempt.agentModel == null || attempt.agentModel === '') return attempt.agentName
  return `${attempt.agentName} (${attempt.agentModel})`
}

function statusToneColor(tone: string): string {
  if (tone === 'ok') return tokens.ok
  if (tone === 'warn') return tokens.warn
  if (tone === 'err') return tokens.err
  if (tone === 'accent') return tokens.accent
  if (tone === 'info') return tokens.info
  return tokens.mid
}
