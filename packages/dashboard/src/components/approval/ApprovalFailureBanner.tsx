/**
 * Inline error banner rendered inside an ApprovalRow when the approval API
 * rejects the request. Shows the API-provided reason and, for stale-branch
 * failures, exact CLI commands the operator can paste immediately.
 *
 * Decision 108: operator-visible state must not lie about live work.
 */

import type { CSSProperties } from 'react'

import { Caps, Mono, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import type { ApprovalFailureInfo } from '@/lib/approval-recovery'

function RecoveryLine({
  label,
  cmd,
  note,
}: {
  label: string
  cmd: string
  note?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginTop: 4,
      }}
    >
      <Caps
        style={{ fontSize: 8, minWidth: 42, flexShrink: 0 } as CSSProperties}
      >
        {label}
      </Caps>
      <Mono
        size={11}
        color={tokens.strong}
        style={{ letterSpacing: 0 } as CSSProperties}
      >
        {cmd}
      </Mono>
      {note && (
        <Mono size={10} color={tokens.dim}>
          {note}
        </Mono>
      )}
    </div>
  )
}

interface ApprovalFailureBannerProps {
  failure: ApprovalFailureInfo
}

export function ApprovalFailureBanner({ failure }: ApprovalFailureBannerProps) {
  const sid = shortId(failure.runId)

  return (
    <div
      data-testid="approval-failure-banner"
      style={{
        marginTop: 16,
        padding: '12px 16px',
        background: `color-mix(in oklab, ${tokens.err} 8%, transparent)`,
        border: `1px solid color-mix(in oklab, ${tokens.err} 28%, transparent)`,
        borderRadius: 8,
      }}
    >
      <Caps color={tokens.err} style={{ fontSize: 9 } as CSSProperties}>
        {failure.isStale
          ? 'Approval failed — stale branch'
          : 'Approval failed'}
      </Caps>

      <Mono
        size={12}
        color={tokens.strong}
        style={{ marginTop: 6, display: 'block' } as CSSProperties}
      >
        {failure.message}
      </Mono>

      <div style={{ marginTop: 12 }}>
        <Caps style={{ fontSize: 8, marginBottom: 4 } as CSSProperties}>
          {failure.isStale ? 'Next steps — pick one' : 'Recovery'}
        </Caps>

        {failure.isStale ? (
          <>
            <RecoveryLine
              label="deny"
              cmd={`ductum deny ${sid} --reason "stale branch"`}
              note="routes back to agent"
            />
            {failure.branch && (
              <RecoveryLine
                label="rebase"
                cmd={`git rebase main`}
                note={`attempt in worktree: ${failure.branch}`}
              />
            )}
            <RecoveryLine
              label="retry"
              cmd={`ductum retry ${sid}`}
              note="after manual rebase"
            />
          </>
        ) : (
          <RecoveryLine
            label="deny"
            cmd={`ductum deny ${sid} --reason "..."`}
            note="routes back to agent"
          />
        )}
      </div>
    </div>
  )
}
