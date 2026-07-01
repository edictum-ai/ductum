import { type CSSProperties } from 'react'

import type { EnrichedRun, Evidence, RunDiff } from '@/api/client'
import { Btn, Caps, Card, Mono, ago, fmt, tokens, usd } from '@/components/signal'
import { shortId } from '@/lib/display'
import { displayRunTaskName, displayStoredName } from '@/lib/project-display'
import { runCost } from '@/lib/run-presentation'
import type { ApprovalFailureInfo } from '@/lib/approval-recovery'
import { ApprovalFailureBanner } from './ApprovalFailureBanner'
import { ApprovalRejectDialog } from './ApprovalRejectDialog'

const ROW_EXIT_STYLE: CSSProperties = {
  opacity: 0,
  transform: 'translateX(-16px) scale(0.98)',
  pointerEvents: 'none',
}

function EvLarge({
  label,
  value,
  subtle,
  tone,
}: {
  label: string
  value: string
  subtle?: string
  tone?: 'ok' | 'err'
}) {
  const color = tone === 'ok' ? tokens.ok : tone === 'err' ? tokens.err : tokens.strong
  return (
    <div>
      <Caps style={{ fontSize: 9 }}>{label}</Caps>
      <div
        style={{
          marginTop: 8,
          fontFamily: tokens.sans,
          fontSize: 26,
          fontWeight: 500,
          color,
          letterSpacing: -0.3,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {subtle && (
        <Mono size={11} color={tokens.dim} style={{ marginTop: 6, display: 'block' }}>
          {subtle}
        </Mono>
      )}
    </div>
  )
}

function latchTone(status: string | null | undefined): 'ok' | 'err' | undefined {
  if (!status) return undefined
  const normalized = status.toLowerCase()
  if (['pass', 'passed', 'success', 'ok'].includes(normalized)) return 'ok'
  if (['fail', 'failed', 'error'].includes(normalized)) return 'err'
  return undefined
}

function reviewSummary(evidence: Evidence[]): { value: string; subtle?: string } {
  for (let i = evidence.length - 1; i >= 0; i -= 1) {
    const event = evidence[i]
    if (event?.type !== 'review') continue
    const critical = typeof event.payload.critical === 'number' ? event.payload.critical : null
    const minor = typeof event.payload.minor === 'number' ? event.payload.minor : null
    if (critical != null || minor != null) {
      return {
        value: minor != null ? `${minor} minor` : `${critical} critical`,
        subtle: critical != null ? `${critical} critical` : undefined,
      }
    }
  }
  return { value: '—' }
}

function linkButtonStyle(color: string): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    padding: 0,
    color,
    fontFamily: tokens.mono,
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 420,
  }
}
interface ApprovalRowProps {
  run: EnrichedRun
  evidence: Evidence[]
  completionSummary: string | null
  diff: RunDiff | null
  approving: boolean
  rejecting: boolean
  exiting: boolean
  /** When non-null the approval API rejected this run and the card stays
   *  visible with inline recovery guidance. */
  approvalError?: ApprovalFailureInfo | null
  onApprove: (run: EnrichedRun) => void
  onReject: (run: EnrichedRun, reason: string) => void
  onOpen: (run: EnrichedRun) => void
}
export function ApprovalRow({
  run,
  evidence,
  completionSummary,
  diff,
  approving,
  rejecting,
  exiting,
  approvalError = null,
  onApprove,
  onReject,
  onOpen,
}: ApprovalRowProps) {
  const ciTone = latchTone(run.ciStatus)
  const ciValue = run.ciStatus ?? '—'
  const ciSubtle = ciTone === 'ok'
    ? 'all checks pass'
    : ciTone === 'err'
      ? 'checks failed'
      : run.ciStatus
        ? 'pending'
        : undefined
  const review = reviewSummary(evidence)
  const reviewTone = run.reviewStatus ? latchTone(run.reviewStatus) : undefined
  const filesValue =
    diff?.totals?.files != null
      ? `${diff.totals.files} file${diff.totals.files === 1 ? '' : 's'}`
      : '—'
  const diffSubtle = diff?.totals
    ? `+${fmt(diff.totals.insertions)} −${fmt(diff.totals.deletions)}`
    : undefined
  const tokensTotal = (run.tokensIn ?? 0) + (run.tokensOut ?? 0)
  const tokensSubtle = tokensTotal > 0 ? `${fmt(tokensTotal)} tokens` : undefined
  const specLabel = displayStoredName(run.specName, 'Spec')
  const taskLabel = displayRunTaskName(run)
  return (
    <Card
      pad={0}
      style={{
        marginBottom: 20,
        transition: 'opacity 500ms ease, transform 500ms ease',
        ...(exiting ? ROW_EXIT_STYLE : null),
      }}
    >
      <div style={{ padding: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            marginBottom: 8,
          }}
        >
            <Mono size={11} color={tokens.accent}>
              {shortId(run.id)}
            </Mono>
          <span style={{ color: tokens.faint }}>·</span>
          <button
            type="button"
            onClick={() => onOpen(run)}
            style={linkButtonStyle(tokens.dim)}
            title="Open attempt"
          >
            {run.projectName} / {specLabel}
          </button>
          <div style={{ flex: 1 }} />
          <Mono size={11} color={tokens.dim}>
            idle {ago(run.lastHeartbeat ?? run.updatedAt)}
          </Mono>
        </div>

        <button
          type="button"
          onClick={() => onOpen(run)}
          style={{
            margin: 0,
            padding: 0,
            border: 'none',
            background: 'transparent',
            fontFamily: tokens.mono,
            fontWeight: 500,
            fontSize: 26,
            letterSpacing: -0.3,
            color: tokens.strong,
            lineHeight: 1.2,
            textAlign: 'left',
            cursor: 'pointer',
          }}
          title="Open attempt"
        >
          {taskLabel}
        </button>

        {completionSummary && (
          <div
            style={{
              marginTop: 8,
              color: tokens.mid,
              fontSize: 14,
              lineHeight: 1.5,
              maxWidth: 720,
              whiteSpace: 'pre-wrap',
            }}
          >
            {completionSummary}
          </div>
        )}

        {approvalError && (
          <ApprovalFailureBanner failure={approvalError} />
        )}

        <div
          style={{
            marginTop: 22,
            padding: 20,
            background: tokens.sunken,
            borderRadius: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 24,
            border: `1px solid ${tokens.hair}`,
          }}
        >
          <EvLarge label="CI" value={ciValue} subtle={ciSubtle} tone={ciTone} />
          <EvLarge label="Review" value={review.value} subtle={review.subtle ?? (run.reviewStatus ?? undefined)} tone={reviewTone} />
          <EvLarge label="Diff" value={filesValue} subtle={diffSubtle} />
          <EvLarge label="Cost" value={runCost(run).label} subtle={tokensSubtle} />
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
          <Btn primary disabled={approving || exiting} onClick={() => onApprove(run)}>
            Approve &amp; merge
          </Btn>
          <Btn onClick={() => onOpen(run)}>Open attempt</Btn>
          <ApprovalRejectDialog
            run={run}
            disabled={rejecting || exiting}
            onReject={onReject}
            variant="default"
          />
          <div style={{ flex: 1 }} />
          <ApprovalRejectDialog run={run} disabled={rejecting || exiting} onReject={onReject} />
        </div>
      </div>
    </Card>
  )
}
