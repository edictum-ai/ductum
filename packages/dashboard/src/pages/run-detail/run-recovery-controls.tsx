import { useMemo, useState } from 'react'

import { Btn, Caps, Card, fieldStyleWithFont, Mono, tokens } from '@/components/signal'
import { operatorAction, type OperatorActionId } from '@/lib/operator-action-manifest'
import type { RunType } from './types'

type ExtendInput = { runId: string; by: number; reason?: string }
type DenyInput = { runId: string; reason: string }

interface RunRecoveryControlsProps {
  run: RunType
  budgetExtendPending: boolean
  budgetDenyPending: boolean
  turnsExtendPending: boolean
  turnsDenyPending: boolean
  budgetExtendError: unknown
  budgetDenyError: unknown
  turnsExtendError: unknown
  turnsDenyError: unknown
  onBudgetExtend: (input: ExtendInput) => void
  onBudgetDeny: (input: DenyInput) => void
  onTurnsExtend: (input: ExtendInput) => void
  onTurnsDeny: (input: DenyInput) => void
}

export function RunRecoveryControls({
  run,
  budgetExtendPending,
  budgetDenyPending,
  turnsExtendPending,
  turnsDenyPending,
  budgetExtendError,
  budgetDenyError,
  turnsExtendError,
  turnsDenyError,
  onBudgetExtend,
  onBudgetDeny,
  onTurnsExtend,
  onTurnsDeny,
}: RunRecoveryControlsProps) {
  const [budgetBy, setBudgetBy] = useState('')
  const [budgetReason, setBudgetReason] = useState('')
  const [turnsBy, setTurnsBy] = useState('')
  const [turnsReason, setTurnsReason] = useState('')
  const reason = run.failReason ?? ''
  const budgetVisible = isBudgetPaused(reason)
  const turnsVisible = isTurnsRecoverable(reason)
  const turnsDenyVisible = isTurnsDenyAllowed(reason)
  const budgetAmount = Number(budgetBy)
  const turnsCount = Number(turnsBy)
  const budgetReasonText = budgetReason.trim()
  const turnsReasonText = turnsReason.trim()
  const commands = useMemo(() => {
    const ids: OperatorActionId[] = []
    if (budgetVisible) ids.push('budgetExtend', 'budgetDeny')
    if (turnsVisible) ids.push('turnsExtend')
    if (turnsDenyVisible) ids.push('turnsDeny')
    return ids.map((id) => commandForRun(id, run.id))
  }, [budgetVisible, run.id, turnsDenyVisible, turnsVisible])

  if (!budgetVisible && !turnsVisible) return null

  const budgetExtendDisabled = budgetExtendPending || !Number.isFinite(budgetAmount) || budgetAmount <= 0
  const budgetDenyDisabled = budgetDenyPending || budgetReasonText === ''
  const turnsExtendDisabled = turnsExtendPending || !Number.isInteger(turnsCount) || turnsCount <= 0
  const turnsDenyDisabled = turnsDenyPending || !turnsDenyVisible || turnsReasonText === ''

  return (
    <Card style={{ marginBottom: 24, borderColor: `color-mix(in oklab, ${tokens.warn} 32%, ${tokens.hair})` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <Caps color={tokens.warn}>Recovery controls</Caps>
        <Mono size={11} color={tokens.dim}>{run.id}</Mono>
      </div>

      <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 10, lineHeight: 1.55 }}>
        {reason}
      </Mono>

      {budgetVisible && (
        <RecoveryRow
          label="Budget"
          amountLabel="Budget extension USD"
          amountValue={budgetBy}
          amountPlaceholder="10.00"
          reasonLabel="Budget reason"
          reasonValue={budgetReason}
          reasonPlaceholder="why this attempt should continue"
          extendLabel={budgetExtendPending ? 'Extending...' : 'Extend budget'}
          denyLabel={budgetDenyPending ? 'Denying...' : 'Deny budget extension'}
          extendDisabled={budgetExtendDisabled}
          denyDisabled={budgetDenyDisabled}
          onAmountChange={setBudgetBy}
          onReasonChange={setBudgetReason}
          onExtend={() => onBudgetExtend({
            runId: run.id,
            by: budgetAmount,
            reason: budgetReasonText === '' ? undefined : budgetReasonText,
          })}
          onDeny={() => onBudgetDeny({ runId: run.id, reason: budgetReasonText })}
        />
      )}

      {turnsVisible && (
        <RecoveryRow
          label="Turns"
          amountLabel="Turn extension count"
          amountValue={turnsBy}
          amountPlaceholder="50"
          reasonLabel="Turns reason"
          reasonValue={turnsReason}
          reasonPlaceholder="why more turns are justified"
          extendLabel={turnsExtendPending ? 'Extending...' : 'Extend turns'}
          denyLabel={turnsDenyPending ? 'Denying...' : 'Deny turn extension'}
          extendDisabled={turnsExtendDisabled}
          denyDisabled={turnsDenyDisabled}
          onAmountChange={setTurnsBy}
          onReasonChange={setTurnsReason}
          onExtend={() => onTurnsExtend({
            runId: run.id,
            by: turnsCount,
            reason: turnsReasonText === '' ? undefined : turnsReasonText,
          })}
          onDeny={() => onTurnsDeny({ runId: run.id, reason: turnsReasonText })}
        />
      )}

      {commands.length > 0 && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 12, lineHeight: 1.55 }}>
          CLI: {commands.join(' · ')}
        </Mono>
      )}
      <ControlError error={budgetExtendError} fallback="Budget extension failed" />
      <ControlError error={budgetDenyError} fallback="Budget denial failed" />
      <ControlError error={turnsExtendError} fallback="Turn extension failed" />
      <ControlError error={turnsDenyError} fallback="Turn denial failed" />
    </Card>
  )
}

interface RecoveryRowProps {
  label: string
  amountLabel: string
  amountValue: string
  amountPlaceholder: string
  reasonLabel: string
  reasonValue: string
  reasonPlaceholder: string
  extendLabel: string
  denyLabel: string
  extendDisabled: boolean
  denyDisabled: boolean
  onAmountChange: (value: string) => void
  onReasonChange: (value: string) => void
  onExtend: () => void
  onDeny: () => void
}

function RecoveryRow({
  label,
  amountLabel,
  amountValue,
  amountPlaceholder,
  reasonLabel,
  reasonValue,
  reasonPlaceholder,
  extendLabel,
  denyLabel,
  extendDisabled,
  denyDisabled,
  onAmountChange,
  onReasonChange,
  onExtend,
  onDeny,
}: RecoveryRowProps) {
  return (
    <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
      <Mono size={11} color={tokens.strong}>{label}</Mono>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 140px) minmax(220px, 1fr) auto auto', gap: 10, alignItems: 'center' }}>
        <input
          aria-label={amountLabel}
          value={amountValue}
          onChange={(event) => onAmountChange(event.currentTarget.value)}
          placeholder={amountPlaceholder}
          inputMode="decimal"
          style={inputStyle(tokens.mono)}
        />
        <input
          aria-label={reasonLabel}
          value={reasonValue}
          onChange={(event) => onReasonChange(event.currentTarget.value)}
          placeholder={reasonPlaceholder}
          style={inputStyle(tokens.sans)}
        />
        <Btn disabled={extendDisabled} onClick={onExtend}>{extendLabel}</Btn>
        <Btn danger disabled={denyDisabled} onClick={onDeny}>{denyLabel}</Btn>
      </div>
    </div>
  )
}

function inputStyle(fontFamily: string) {
  return fieldStyleWithFont(fontFamily)
}

function commandForRun(id: OperatorActionId, runId: string): string {
  const command = operatorAction(id).cliCommand
  if (command == null) throw new Error(`Recovery action ${id} is missing a CLI command`)
  return command.replace('<attemptId>', runId)
}

export function isBudgetPaused(reason: string | null | undefined): boolean {
  return reason != null && (reason.startsWith('cost_budget_paused') || reason.startsWith('spec_cost_budget_paused'))
}

export function isTurnsRecoverable(reason: string | null | undefined): boolean {
  return reason != null && (reason.startsWith('max_turns_paused') || reason.startsWith('max_turns_reached'))
}

export function isTurnsDenyAllowed(reason: string | null | undefined): boolean {
  return reason != null && reason.startsWith('max_turns_paused')
}

function ControlError({ error, fallback }: { error: unknown; fallback: string }) {
  if (error == null) return null
  return (
    <Mono color={tokens.err} style={{ display: 'block', marginTop: 10 }}>
      {error instanceof Error ? error.message : fallback}
    </Mono>
  )
}
