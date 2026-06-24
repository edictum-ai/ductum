import type { ActiveDispatchSession } from './dispatcher-types.js'
import { canResumeStalledRun } from './dispatcher-resume.js'
import type { AttemptLease } from './attempt-lease.js'
import type {
  AttemptLeaseRepo,
  RunCheckpointRepo,
  SessionRunMappingRepo,
  TaskRepo,
} from './repos/interfaces.js'
import type { RunActivityRepo } from './repos/run-activity.js'
import { describeInFlightTool, findInFlightToolCall, hasFreshRunHeartbeat } from './run-tool-liveness.js'
import type { Run, RunId, SessionRunMapping } from './types.js'
import { isWorkflowOwnedRun } from './workflow-owned-run.js'

export type StartupReconcileDisposition =
  | 'already-live'
  | 'resumable'
  | 'completed-but-unrecorded'
  | 'dead-claim'
  | 'genuinely-stalled'
  | 'no-mapping'

export type StartupReconcileAction =
  | 'none'
  | 'resume-from-checkpoint'
  | 'stall'
  | 'finalize'

export interface StartupReconcileEntry {
  runId: RunId
  disposition: StartupReconcileDisposition
  action: StartupReconcileAction
  reason: string
  sessionId?: string
  checkpointStage?: string
  leaseStatus?: AttemptLease['status']
  fenceToken?: number
  inFlightTool?: string
  resumedRunId?: RunId
  error?: string
}

export interface StartupRunClassification extends StartupReconcileEntry {
  mapping: SessionRunMapping | null
}

export interface StartupReconcileClassifierDeps {
  sessionMappingRepo: SessionRunMappingRepo
  taskRepo: TaskRepo
  activeSessions: Map<RunId, ActiveDispatchSession>
  attemptLeaseRepo?: AttemptLeaseRepo
  runCheckpointRepo?: RunCheckpointRepo
  runActivityRepo?: RunActivityRepo
  canSeedWorkflowStage: boolean
  now: Date
}

export function classifyStartupRun(
  deps: StartupReconcileClassifierDeps,
  run: Run,
): StartupRunClassification {
  const activeLease = deps.attemptLeaseRepo?.getActiveForRun(run.id, deps.now) ?? null
  const latestLease = deps.attemptLeaseRepo?.getLatestForRun(run.id) ?? null
  const mapping = deps.sessionMappingRepo.getByRunId(run.id)
  const inFlightTool = describeInFlightTool(findInFlightToolCall(deps.runActivityRepo, run.id))

  if (hasLiveClaim(deps, run.id, activeLease)) {
    return entry(run, mapping, 'already-live', 'none', 'valid live lease or active dispatcher session', latestLease, inFlightTool)
  }

  if (inFlightTool != null && hasFreshRunHeartbeat(run, deps.now)) {
    return entry(run, mapping, 'already-live', 'none', 'fresh heartbeat during in-flight tool call', latestLease, inFlightTool)
  }

  if (isWorkflowOwnedRun(run, deps.taskRepo)) {
    return entry(run, mapping, 'already-live', 'none', 'workflow-owned run does not need startup recovery', latestLease, inFlightTool)
  }

  if (canResumeStalledRun(deps.runCheckpointRepo, run, deps.canSeedWorkflowStage)) {
    const checkpoint = deps.runCheckpointRepo?.get(run.id) ?? null
    return {
      ...entry(run, mapping, 'resumable', 'resume-from-checkpoint', 'expired or missing live claim with resumable checkpoint', latestLease, inFlightTool),
      checkpointStage: checkpoint?.stage,
    }
  }

  if (mapping == null) {
    return entry(run, mapping, 'no-mapping', 'stall', 'harness session mapping missing across server restart', latestLease, inFlightTool)
  }

  if (latestLease?.status === 'expired') {
    return entry(run, mapping, 'dead-claim', 'stall', 'expired attempt lease with no resumable checkpoint', latestLease, inFlightTool)
  }

  return entry(run, mapping, 'genuinely-stalled', 'stall', 'no live lease or resumable checkpoint across server restart', latestLease, inFlightTool)
}

function hasLiveClaim(
  deps: StartupReconcileClassifierDeps,
  runId: RunId,
  activeLease: AttemptLease | null,
): boolean {
  if (deps.attemptLeaseRepo == null) return deps.activeSessions.has(runId)
  return activeLease != null
}

function entry(
  run: Run,
  mapping: SessionRunMapping | null,
  disposition: StartupReconcileDisposition,
  action: StartupReconcileAction,
  reason: string,
  lease: AttemptLease | null,
  inFlightTool: string | null,
): StartupRunClassification {
  return {
    runId: run.id,
    disposition,
    action,
    reason,
    mapping,
    ...(mapping == null ? {} : { sessionId: mapping.sessionId }),
    ...(lease == null ? {} : { leaseStatus: lease.status, fenceToken: lease.fenceToken }),
    ...(inFlightTool == null ? {} : { inFlightTool }),
  }
}
