/**
 * Canonical wire types for the run UI DTO.
 *
 * Pure type-only module: zero runtime imports, zero Node-only deps. Both
 * `@ductum/api` (server-side, where the contract is built) and
 * `@ductum/dashboard` (browser-side, where it is rendered) reference
 * this exact declaration so the wire shape cannot drift.
 *
 * Owner: `@ductum/api/lib/ui-contract` (ADR 0163 §1). The runtime
 * `buildRunUiContract()` lives next door in `ui-contract.ts` and is the
 * single producer of these shapes.
 *
 * The dashboard imports this file via a TypeScript path alias
 * (`@ductum/ui-contract`) so it can read the canonical types without
 * pulling `@ductum/core`'s Node-only runtime into the browser bundle.
 */

export type UiTone = 'ok' | 'warn' | 'err' | 'info' | 'accent' | 'mid'

export type UiCostState = 'measured' | 'pending' | 'unpriced' | 'unmeasured'

export type RunUiStatusKey =
  | 'running'
  | 'awaiting_review'
  | 'awaiting_approval'
  | 'failed'
  | 'stalled'
  | 'cancelled'
  | 'paused'
  | 'frozen'
  | 'quarantined'
  | 'done'

export interface RunUiContract {
  schemaVersion: 'ductum.ui.run.v1'
  status: {
    key: RunUiStatusKey
    label: string
    tone: UiTone
    terminal: boolean
    needsAttention: boolean
  }
  cost: {
    usd: number
    label: string
    state: UiCostState
  }
  href: string | null
}
