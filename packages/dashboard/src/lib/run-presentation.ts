import type { EnrichedRun, ProjectRun, Run, RunUiContract, UiTone } from '@/api/client'
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABEL,
  NEEDS_OPERATOR_DISPLAY_STATUSES,
  type DisplayStatus,
} from '@/lib/derived-status'
import { shortId } from '@/lib/display'
import { formatCost } from '@/lib/utils'

type AnyRun = Run | EnrichedRun | ProjectRun

export interface CostPresentation {
  usd: number
  label: string
  state: 'measured' | 'pending' | 'unpriced' | 'unmeasured'
}

export function runDisplayStatus(run: Pick<AnyRun, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: RunUiContract }): DisplayStatus {
  return run.ui?.status.key ?? deriveDisplayStatus(run)
}

export function runStatusLabel(run: Pick<AnyRun, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: RunUiContract }): string {
  return run.ui?.status.label ?? DISPLAY_STATUS_LABEL[runDisplayStatus(run)]
}

export function runStatusTone(run: Pick<AnyRun, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: RunUiContract }): UiTone {
  return run.ui?.status.tone ?? fallbackTone(runDisplayStatus(run))
}

export function runNeedsAttention(run: Pick<AnyRun, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: RunUiContract }): boolean {
  return run.ui?.status.needsAttention ?? NEEDS_OPERATOR_DISPLAY_STATUSES.has(runDisplayStatus(run))
}

export function runCost(run: Pick<AnyRun, 'stage' | 'terminalState' | 'costUsd' | 'tokensIn' | 'tokensOut'> & { ui?: RunUiContract }): CostPresentation {
  if (run.ui?.cost != null) return run.ui.cost
  const usd = run.costUsd ?? 0
  const hasTokens = (run.tokensIn ?? 0) > 0 || (run.tokensOut ?? 0) > 0
  if (usd > 0) return { usd, label: formatCost(usd), state: 'measured' }
  // $0 with real tokens can only mean the model had no pricing rate: a
  // priced model always yields >0 for any tokens (cache rates are positive
  // multiples, never zero), so a measured sub-cent cost is already covered
  // by the `usd > 0` branch above. Usage IS known here — cost is unknown
  // only because the rate is missing — so surface "unpriced", not
  // "$0"/"free". A scanner miss records no tokens and falls through to
  // "unmeasured" below (distinct: no usage known at all). Mirrors ui-contract.
  if (hasTokens) return { usd, label: 'unpriced', state: 'unpriced' }
  if (run.terminalState == null && run.stage !== 'done') return { usd, label: 'pending', state: 'pending' }
  return { usd, label: 'unmeasured', state: 'unmeasured' }
}

/**
 * True when a run's cost cannot be represented as a trustworthy dollar
 * figure — either we never saw usage (`unmeasured`) or we saw usage but
 * the model has no price entry (`unpriced`). Rollups use this so an
 * unpriced run is flagged alongside an unmeasured one instead of being
 * silently shown as $0. (Not to be confused with the homepage "lack
 * usage data" caveat, which is `unmeasured`-only — unpriced runs DO
 * have usage.)
 */
export function isCostUnknown(state: CostPresentation['state']): boolean {
  return state === 'unmeasured' || state === 'unpriced'
}

export function runsCostLabel(
  runs: readonly (Pick<AnyRun, 'stage' | 'terminalState' | 'costUsd' | 'tokensIn' | 'tokensOut'> & { ui?: RunUiContract })[],
): string {
  const costs = runs.map((run) => runCost(run))
  const usd = costs.reduce((sum, cost) => sum + cost.usd, 0)
  if (usd > 0) return formatCost(usd)
  if (costs.some((cost) => cost.state === 'pending')) return 'pending'
  if (costs.some((cost) => isCostUnknown(cost.state))) return 'unmeasured'
  return formatCost(0)
}

export function runHref(run: EnrichedRun): string {
  if (run.ui?.href != null) return run.ui.href
  return `/${enc(run.projectName)}/${enc(run.specName)}/${enc(run.taskName)}/${shortId(run.id)}`
}

function fallbackTone(status: DisplayStatus): UiTone {
  switch (status) {
    case 'done': return 'ok'
    case 'failed': return 'err'
    case 'quarantined': return 'err'
    case 'stalled': return 'warn'
    case 'frozen': return 'warn'
    case 'awaiting_review': return 'accent'
    case 'awaiting_approval': return 'accent'
    case 'cancelled': return 'mid'
    case 'paused': return 'mid'
    default: return 'info'
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}
