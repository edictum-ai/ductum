/**
 * Harness contract shim.
 *
 * D163 §6 names `@ductum/core` as the canonical owner of the harness
 * session / adapter / event contracts. This file re-exports those
 * symbols so adapter implementations and tests inside the harness
 * package continue to import `from './types.js'` while the single
 * declaration lives in core. Adding a new field anywhere in this
 * contract requires touching only `@ductum/core` — no parallel
 * declaration to keep in sync.
 */

export type {
  HarnessAdapter,
  HarnessEvent,
  HarnessKillReason,
  HarnessSandboxExecution,
  HarnessSession,
  HarnessSessionResult,
  SpawnOptions,
  TokenUsageDelta,
} from '@ductum/core'
