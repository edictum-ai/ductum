import type { AttemptLeaseRepo, EvidenceRepo, RunRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { ActiveDispatchSession } from './dispatcher-types.js'
import { COMPLETION_RELEASE_TIMEOUT_MS } from './dispatcher-types.js'
import type { FencingToken } from './attempt-lease.js'
import { releaseDispatchLease } from './dispatcher-lease.js'
import { log } from './logger.js'
import { createId, type RunId } from './types.js'

export interface CompletionReleaseState {
  releaseAttempted: boolean
  activeRemoved: boolean
  leaseReleased: boolean
}

export async function releaseBeforeCompletionRouting(input: {
  active: ActiveDispatchSession | null
  runId: RunId
  activeSessions: Map<RunId, ActiveDispatchSession>
  attemptLeaseRepo: AttemptLeaseRepo | undefined
  releaseSession: (active: ActiveDispatchSession) => Promise<void>
  runRepo: RunRepo
  stateMachine: RunStateMachine
  evidenceRepo: EvidenceRepo | undefined
  fenceOptions: { fenceToken?: FencingToken; fenceNow?: Date }
  now: () => Date
}, state: CompletionReleaseState): Promise<boolean> {
  if (input.active == null) return true
  state.releaseAttempted = true
  try {
    await withTimeout(
      input.releaseSession(input.active),
      COMPLETION_RELEASE_TIMEOUT_MS,
      `completion release timed out after ${COMPLETION_RELEASE_TIMEOUT_MS}ms`,
    )
  } catch (error) {
    recordCompletionCleanupFailure(input, error)
    forgetActive(input, state)
    releaseLease(input, state)
    return false
  }
  forgetActive(input, state)
  releaseLease(input, state)
  return true
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

export function forgetActive(input: {
  active: ActiveDispatchSession | null
  runId: RunId
  activeSessions: Map<RunId, ActiveDispatchSession>
}, state: CompletionReleaseState): void {
  if (input.active == null || state.activeRemoved) return
  input.activeSessions.delete(input.runId)
  state.activeRemoved = true
}

export function releaseLease(input: {
  active: ActiveDispatchSession | null
  attemptLeaseRepo: AttemptLeaseRepo | undefined
  now: () => Date
}, state: CompletionReleaseState): void {
  if (input.active == null || state.leaseReleased) return
  releaseDispatchLease(input.attemptLeaseRepo, input.active.lease, input.now())
  state.leaseReleased = true
}

function recordCompletionCleanupFailure(input: {
  runId: RunId
  runRepo: RunRepo
  stateMachine: RunStateMachine
  evidenceRepo: EvidenceRepo | undefined
  fenceOptions: { fenceToken?: FencingToken; fenceNow?: Date }
}, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const reason = `sandbox_cleanup_failed: ${message}`
  log.error('dispatcher', `sandbox cleanup failed for ${input.runId.slice(0, 8)} before completion routing: ${message}`)
  const latest = input.runRepo.get(input.runId)
  if (latest != null && latest.stage !== 'done' && latest.terminalState == null) {
    input.stateMachine.markFailed(input.runId, reason, input.fenceOptions)
  } else if (latest != null) {
    input.runRepo.updateFailure(input.runId, reason, false)
    input.runRepo.updateWorkflowState(input.runId, { pendingApproval: false, blockedReason: null })
  }
  const evidence = {
    id: createId<'EvidenceId'>(),
    runId: input.runId,
    type: 'custom',
    payload: { kind: 'sandbox.cleanup_failure', reason, phase: 'completion_release' },
  } as const
  if (input.fenceOptions.fenceToken != null && input.evidenceRepo?.createFenced != null) {
    input.evidenceRepo.createFenced(evidence, input.fenceOptions.fenceToken, input.fenceOptions.fenceNow)
  } else {
    input.evidenceRepo?.create(evidence)
  }
}
