import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABEL,
  runPath,
  type DisplayStatus,
  type Run,
} from '@ductum/core'

import type { RunUiContract, RunUiStatusKey, UiTone } from './ui-contract-types.js'

export type { RunUiContract, RunUiStatusKey, UiCostState, UiTone } from './ui-contract-types.js'

// Compile-time guarantee that DisplayStatus and RunUiStatusKey remain
// the same union — if either side adds or drops a member, the assignment
// below fails to type-check.
type _StatusKeysEqual = [DisplayStatus] extends [RunUiStatusKey]
  ? [RunUiStatusKey] extends [DisplayStatus]
    ? true
    : never
  : never
const _statusKeysEqual: _StatusKeysEqual = true
void _statusKeysEqual

export function buildRunUiContract(
  run: Pick<Run, 'id' | 'stage' | 'terminalState' | 'pendingApproval' | 'costUsd' | 'tokensIn' | 'tokensOut'>,
  context?: { projectName: string; specName: string; taskName: string; workflowFollowup?: 'review' | 'fix' | null },
): RunUiContract {
  const status: RunUiStatusKey = context?.workflowFollowup === 'review'
    || context?.workflowFollowup === 'fix'
    ? 'awaiting_review'
    : deriveDisplayStatus(run)
  const label = context?.workflowFollowup === 'fix' ? 'Awaiting fix' : DISPLAY_STATUS_LABEL[status]
  return {
    schemaVersion: 'ductum.ui.run.v1',
    status: {
      key: status,
      label,
      tone: statusTone(status),
      terminal: run.terminalState != null || status === 'done',
      needsAttention: status === 'failed' || status === 'stalled',
    },
    cost: runCost(run),
    href: context == null ? null : runPath(context.projectName, context.specName, context.taskName, run.id),
  }
}

function statusTone(status: RunUiStatusKey): UiTone {
  switch (status) {
    case 'done': return 'ok'
    case 'failed': return 'err'
    case 'stalled': return 'warn'
    case 'awaiting_review': return 'accent'
    case 'awaiting_approval': return 'accent'
    case 'cancelled': return 'mid'
    default: return 'info'
  }
}

function runCost(
  run: Pick<Run, 'stage' | 'terminalState' | 'costUsd' | 'tokensIn' | 'tokensOut'>,
): RunUiContract['cost'] {
  const usd = run.costUsd ?? 0
  const hasTokens = (run.tokensIn ?? 0) > 0 || (run.tokensOut ?? 0) > 0
  if (usd > 0) return { usd, label: formatCost(usd), state: 'measured' }
  // $0 with real tokens can only mean the model had no pricing rates: a
  // priced model always yields >0 for any tokens (cache rates are positive
  // multiples, never zero), so a measured sub-cent cost is already covered
  // by the `usd > 0` branch above. This is the unknown-cost case — surface
  // "unmeasured", not "$0"/"free".
  if (hasTokens) return { usd, label: 'unmeasured', state: 'unmeasured' }
  if (run.terminalState == null && run.stage !== 'done') return { usd, label: 'pending', state: 'pending' }
  return { usd, label: 'unmeasured', state: 'unmeasured' }
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}
