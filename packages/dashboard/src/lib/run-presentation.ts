import type { EnrichedRun, ProjectRun, Run, RunUiContract, UiTone } from '@/api/client'
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABEL,
  type DisplayStatus,
} from '@/lib/derived-status'
import { shortId } from '@/lib/display'
import { formatCost } from '@/lib/utils'

type AnyRun = Run | EnrichedRun | ProjectRun

export interface CostPresentation {
  usd: number
  label: string
  state: 'measured' | 'pending' | 'unmeasured'
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
  return run.ui?.status.needsAttention ?? ['failed', 'stalled'].includes(runDisplayStatus(run))
}

export function runCost(run: Pick<AnyRun, 'stage' | 'terminalState' | 'costUsd' | 'tokensIn' | 'tokensOut'> & { ui?: RunUiContract }): CostPresentation {
  if (run.ui?.cost != null) return run.ui.cost
  const usd = run.costUsd ?? 0
  const hasTokens = (run.tokensIn ?? 0) > 0 || (run.tokensOut ?? 0) > 0
  if (usd > 0) return { usd, label: formatCost(usd), state: 'measured' }
  if (hasTokens) return { usd, label: '<$0.01', state: 'measured' }
  if (run.terminalState == null && run.stage !== 'done') return { usd, label: 'pending', state: 'pending' }
  return { usd, label: 'unmeasured', state: 'unmeasured' }
}

export function runsCostLabel(
  runs: readonly (Pick<AnyRun, 'stage' | 'terminalState' | 'costUsd' | 'tokensIn' | 'tokensOut'> & { ui?: RunUiContract })[],
): string {
  const costs = runs.map((run) => runCost(run))
  const usd = costs.reduce((sum, cost) => sum + cost.usd, 0)
  if (usd > 0) return formatCost(usd)
  if (costs.some((cost) => cost.state === 'pending')) return 'pending'
  if (costs.some((cost) => cost.state === 'unmeasured')) return 'unmeasured'
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
    case 'stalled': return 'warn'
    case 'awaiting_review': return 'accent'
    case 'awaiting_approval': return 'accent'
    case 'cancelled': return 'mid'
    default: return 'info'
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}
