/** Shared stage/status display data + status->tone mappers.
 *
 *  Color is NOT decided here. Each mapper returns a Tone; components turn a
 *  Tone into classes via toneBadgeClass()/toneTextClass() (chip) or
 *  toneColor() (inline), all backed by the `--signal-*` CSS vars. That keeps
 *  status color in one token layer instead of literal Tailwind strings, and
 *  lets a new run state theme itself by mapping to a tone. The accent
 *  (signal-blue) stays rationed for "operator, act here" — in-flight work
 *  reads as `info`, not accent. */

import type { Tone } from '@/components/signal/tokens'

export const WORKFLOW_STAGES = [
  'understand',
  'implement',
  'ship',
  'done',
] as const

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export const STAGE_LABEL: Record<string, string> = {
  understand: 'Understanding',
  implement: 'Implementing',
  ship: 'Shipping',
  done: 'Done',
  failed: 'Failed',
  stalled: 'Stalled',
}

/** Workflow / terminal stage → tone. */
export function stageTone(stage: string): Tone {
  switch (stage) {
    case 'done': return 'ok'
    case 'failed': return 'err'
    case 'stalled': return 'warn'
    case 'understand':
    case 'implement':
    case 'ship':
    case 'review':
      return 'info'
    default: return 'mid'
  }
}

/** Task status → tone. */
export function taskStatusTone(status: string): Tone {
  switch (status) {
    case 'done': return 'ok'
    case 'failed': return 'err'
    case 'blocked': return 'warn'
    case 'assigned':
    case 'in-progress':
    case 'ready':
    case 'active':
      return 'info'
    default: return 'mid' // pending + unknown
  }
}

/** Spec status → tone. */
export function specStatusTone(status: string): Tone {
  switch (status) {
    case 'approved':
    case 'done':
      return 'ok'
    case 'failed': return 'err'
    case 'reviewed':
    case 'implementing':
      return 'info'
    default: return 'mid' // draft + unknown
  }
}

/** Evidence kind → tone. */
export function evidenceTone(type: string): Tone {
  switch (type) {
    case 'review': return 'ok'
    case 'lint': return 'warn'
    case 'ci':
    case 'test':
      return 'info'
    default: return 'mid'
  }
}

/** Gate result → tone. */
export function gateTone(result: string): Tone {
  switch (result) {
    case 'allowed': return 'ok'
    case 'blocked': return 'err'
    case 'pending': return 'warn'
    default: return 'mid'
  }
}

/** CI / review latch value → tone. */
export function latchTone(value: string): Tone {
  switch (value) {
    case 'pass': return 'ok'
    case 'fail': return 'err'
    case 'pending': return 'warn'
    default: return 'mid'
  }
}

/** Tool name → tone for the activity feed. Accent stays rationed for "act
 *  here" operator affordances, so no passive feed label uses it. */
export function toolTone(toolName: string): Tone {
  switch (toolName) {
    case 'Write':
    case 'Edit':
      return 'ok'
    case 'Bash':
      return 'warn'
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'ToolSearch':
    case 'Agent':
      return 'info'
    default: return 'mid'
  }
}
