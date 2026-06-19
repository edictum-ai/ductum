import { useMemo, useState } from 'react'

import { Btn, Caps, Card, Mono, tokens } from '@/components/signal'
import { OPERATOR_ACTION_MANIFEST, operatorAction, type OperatorActionId } from '@/lib/operator-action-manifest'
import type { RunType } from './types'

type ReasonInput = { runId: string; reason: string }
type CancelInput = ReasonInput & { cleanupWorktree: boolean }

interface RunControlsProps {
  run: RunType
  canApprove: boolean
  canReject: boolean
  canRetry: boolean
  canCancel: boolean
  approvePending: boolean
  rejectPending: boolean
  retryPending: boolean
  cancelPending: boolean
  approveError: unknown
  rejectError: unknown
  retryError: unknown
  cancelError: unknown
  onApprove: (input: ReasonInput) => void
  onReject: (input: ReasonInput) => void
  onRetry: (input: ReasonInput) => void
  onCancel: (input: CancelInput) => void
}

export function RunControls({
  run,
  canApprove,
  canReject,
  canRetry,
  canCancel,
  approvePending,
  rejectPending,
  retryPending,
  cancelPending,
  approveError,
  rejectError,
  retryError,
  cancelError,
  onApprove,
  onReject,
  onRetry,
  onCancel,
}: RunControlsProps) {
  const [reason, setReason] = useState('')
  const [cleanupWorktree, setCleanupWorktree] = useState(false)
  const trimmedReason = reason.trim()
  const hasReason = trimmedReason.length > 0
  const visibleActions = useMemo(
    () => buildVisibleActions({ canApprove, canReject, canRetry, canCancel }),
    [canApprove, canReject, canRetry, canCancel],
  )
  const cliCommands = visibleActions.map((id) => commandForRun(id, run.id))

  function submit(id: OperatorActionId) {
    if (!hasReason) return
    if (id === 'approve') onApprove({ runId: run.id, reason: trimmedReason })
    if (id === 'reject') onReject({ runId: run.id, reason: trimmedReason })
    if (id === 'retry') onRetry({ runId: run.id, reason: trimmedReason })
    if (id === 'cancel') onCancel({ runId: run.id, reason: trimmedReason, cleanupWorktree })
  }

  return (
    <Card style={{ marginBottom: 24, borderColor: `color-mix(in oklab, ${tokens.accent} 28%, ${tokens.hair})` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Caps color={tokens.accent}>Intervention controls</Caps>
        </div>
        <Mono size={11} color={tokens.dim}>{run.id}</Mono>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 10, alignItems: 'center' }}>
        <input
          aria-label="Operator reason"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          placeholder="operator reason"
          style={{
            width: '100%',
            minWidth: 0,
            border: `1px solid ${tokens.rule}`,
            borderRadius: 7,
            background: tokens.sunken,
            color: tokens.fg,
            padding: '8px 10px',
            fontFamily: tokens.sans,
            fontSize: 13,
          }}
        />
        {canCancel && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: tokens.mid, fontSize: 12, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={cleanupWorktree}
              onChange={(event) => setCleanupWorktree(event.currentTarget.checked)}
              aria-label="Cleanup worktree"
            />
            Cleanup worktree
          </label>
        )}
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {OPERATOR_ACTION_MANIFEST.map((action) => (
          <Btn
            key={action.id}
            primary={action.id === 'approve'}
            danger={action.id === 'reject' || action.id === 'cancel'}
            disabled={isDisabled(action.id, { canApprove, canReject, canRetry, canCancel, approvePending, rejectPending, retryPending, cancelPending, hasReason })}
            onClick={() => submit(action.id)}
            title={disabledReason(action.id, { canApprove, canReject, canRetry, canCancel, hasReason })}
            data-testid={`run-control-${action.id}`}
          >
            {pendingLabel(action.id, { approvePending, rejectPending, retryPending, cancelPending }) ?? action.label}
          </Btn>
        ))}
      </div>

      {cliCommands.length > 0 && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 12, lineHeight: 1.55 }}>
          CLI: {cliCommands.join(' · ')}
        </Mono>
      )}
      {cliCommands.length === 0 && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 12 }}>
          No mutating controls are available for this attempt state.
        </Mono>
      )}
      <ControlError error={approveError} fallback="Approval failed" />
      <ControlError error={rejectError} fallback="Reject failed" />
      <ControlError error={retryError} fallback="Retry failed" />
      <ControlError error={cancelError} fallback="Cancel failed" />
    </Card>
  )
}

function buildVisibleActions(input: { canApprove: boolean; canReject: boolean; canRetry: boolean; canCancel: boolean }): OperatorActionId[] {
  const actions: OperatorActionId[] = []
  if (input.canApprove) actions.push('approve')
  if (input.canReject) actions.push('reject')
  if (input.canRetry) actions.push('retry')
  if (input.canCancel) actions.push('cancel')
  return actions
}

function commandForRun(id: OperatorActionId, runId: string): string {
  return operatorAction(id).cliCommand.replace('<attemptId>', runId)
}

function isDisabled(
  id: OperatorActionId,
  state: {
    canApprove: boolean
    canReject: boolean
    canRetry: boolean
    canCancel: boolean
    approvePending: boolean
    rejectPending: boolean
    retryPending: boolean
    cancelPending: boolean
    hasReason: boolean
  },
): boolean {
  if (!state.hasReason) return true
  if (id === 'approve') return !state.canApprove || state.approvePending
  if (id === 'reject') return !state.canReject || state.rejectPending
  if (id === 'retry') return !state.canRetry || state.retryPending
  return !state.canCancel || state.cancelPending
}

function disabledReason(
  id: OperatorActionId,
  state: { canApprove: boolean; canReject: boolean; canRetry: boolean; canCancel: boolean; hasReason: boolean },
): string | undefined {
  if (!state.hasReason) return 'Add an operator reason first.'
  if (id === 'approve' && !state.canApprove) return 'Unlocks when this attempt is waiting for approval.'
  if (id === 'reject' && !state.canReject) return 'Unlocks when this attempt is waiting for approval.'
  if (id === 'retry' && !state.canRetry) return 'Unlocks for recoverable failed or stalled attempts.'
  if (id === 'cancel' && !state.canCancel) return 'Unlocks only while the attempt is still active.'
  return undefined
}

function pendingLabel(
  id: OperatorActionId,
  state: { approvePending: boolean; rejectPending: boolean; retryPending: boolean; cancelPending: boolean },
): string | null {
  if (id === 'approve' && state.approvePending) return 'Approving...'
  if (id === 'reject' && state.rejectPending) return 'Rejecting...'
  if (id === 'retry' && state.retryPending) return 'Retrying...'
  if (id === 'cancel' && state.cancelPending) return 'Cancelling...'
  return null
}

function ControlError({ error, fallback }: { error: unknown; fallback: string }) {
  if (error == null) return null
  return (
    <Mono color={tokens.err} style={{ display: 'block', marginTop: 10 }}>
      {error instanceof Error ? error.message : fallback}
    </Mono>
  )
}
