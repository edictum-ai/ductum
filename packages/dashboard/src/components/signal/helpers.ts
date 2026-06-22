import type { EnrichedRun, ProjectRun, Run, RunUiContract } from '@/api/client'
import { isAwaitingApproval } from '@/lib/derived-status'

import type { Tone } from './tokens'

/** USD formatter: `$2.34`. Always 2 decimals. */
export function usd(n: number): string {
  return '$' + n.toFixed(2)
}

/** Compact integer: `1.2k`, `420`. */
export function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

/** Short time-ago: `8s`, `12m`, `3h`, `2d`. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const secs = (Date.now() - new Date(iso).getTime()) / 1000
  if (secs < 0) return '0s'
  if (secs < 60) return Math.floor(secs) + 's'
  if (secs < 3600) return Math.floor(secs / 60) + 'm'
  if (secs < 86400) return Math.floor(secs / 3600) + 'h'
  return Math.floor(secs / 86400) + 'd'
}

/**
 * Narrow status derivation for Signal's tone system. Maps the full API
 * run shape onto the five presentational states (failed, stalled,
 * awaiting approval, done, running/fixing/reviewing/watching) used by
 * the Signal primitives. Order matters — terminal states dominate.
 */
export interface RunStatus {
  kind: 'failed' | 'stalled' | 'cancelled' | 'blocked' | 'approval' | 'done' | 'reviewing' | 'watching' | 'fixing' | 'running'
  label: string
  tone: Tone
}

type AnyRun = (Run | EnrichedRun | ProjectRun) & { ui?: RunUiContract }

export function statusOf(run: AnyRun): RunStatus {
  if (run.ui != null) return statusFromUi(run.ui)
  if (run.terminalState === 'failed') return { kind: 'failed', label: 'Failed', tone: 'err' }
  if (run.terminalState === 'quarantined') return { kind: 'failed', label: 'Quarantined', tone: 'err' }
  if (run.terminalState === 'stalled') return { kind: 'stalled', label: 'Stalled', tone: 'warn' }
  if (run.terminalState === 'frozen') return { kind: 'stalled', label: 'Frozen', tone: 'warn' }
  if (run.terminalState === 'cancelled') return { kind: 'cancelled', label: 'Cancelled', tone: 'mid' }
  if (run.terminalState === 'paused') return { kind: 'cancelled', label: 'Paused', tone: 'mid' }
  if (run.stage === 'failed') return { kind: 'failed', label: 'Failed', tone: 'err' }
  if (run.stage === 'stalled') return { kind: 'stalled', label: 'Stalled', tone: 'warn' }
  if (isAwaitingApproval(run)) return { kind: 'approval', label: 'Awaiting approval', tone: 'accent' }
  if (run.stage === 'done') return { kind: 'done', label: 'Done', tone: 'ok' }
  if ('blockedReason' in run && run.blockedReason != null && run.blockedReason.trim() !== '') {
    return { kind: 'blocked', label: 'Blocked', tone: 'warn' }
  }
  if (run.stage === 'review') return { kind: 'reviewing', label: 'Reviewing', tone: 'info' }
  // 'watch' isn't a stage in the API (the api uses per-run kinds via
  // parentRunId / agentId), so we fall through to running for unknown
  // shapes rather than fabricating.
  return { kind: 'running', label: 'Running', tone: 'mid' }
}

function statusFromUi(ui: RunUiContract): RunStatus {
  switch (ui.status.key) {
    case 'awaiting_review':
      return { kind: 'reviewing', label: ui.status.label, tone: ui.status.tone }
    case 'awaiting_approval':
      return { kind: 'approval', label: ui.status.label, tone: ui.status.tone }
    case 'running':
      return { kind: 'running', label: ui.status.label, tone: ui.status.tone }
    // The new terminal states have no dedicated Signal kind; the label/tone
    // come straight from the contract so the row still reads correctly, and
    // the kind groups with its closest presentational sibling.
    case 'frozen':
      return { kind: 'stalled', label: ui.status.label, tone: ui.status.tone }
    case 'quarantined':
      return { kind: 'failed', label: ui.status.label, tone: ui.status.tone }
    case 'paused':
      return { kind: 'cancelled', label: ui.status.label, tone: ui.status.tone }
    default:
      // 'failed' | 'stalled' | 'cancelled' | 'done' map 1:1 onto RunStatus.kind.
      return { kind: ui.status.key, label: ui.status.label, tone: ui.status.tone }
  }
}

/** True when the run is live — heartbeating, not terminal, not done. */
export function isLive(run: AnyRun): boolean {
  return run.terminalState == null && run.stage !== 'done' && run.stage !== 'failed' && run.stage !== 'stalled'
}
