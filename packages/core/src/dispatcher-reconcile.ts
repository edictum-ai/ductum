import { log } from './logger.js'
import { redactPublicOutput, redactPublicText } from './public-redaction.js'
import type {
  AgentRepo,
  AttemptLeaseRepo,
  EvidenceRepo,
  RunCheckpointRepo,
  RunRepo,
  SessionRunMappingRepo,
  TaskRepo,
} from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import { createId, type Run, type RunId } from './types.js'
import type { ActiveDispatchSession } from './dispatcher-types.js'
import {
  classifyStartupRun,
  type StartupReconcileDisposition,
  type StartupReconcileEntry,
} from './dispatcher-reconcile-classifier.js'

export const STARTUP_RESUME_UNAVAILABLE_REASON =
  'checkpoint resume unavailable across server restart'
export const STARTUP_RESUME_SCHEDULED_REASON =
  'checkpoint resume scheduled across server restart'
export const STARTUP_NO_MAPPING_REASON =
  'harness session mapping missing across server restart'
export const STARTUP_DEAD_CLAIM_REASON =
  'expired attempt lease across server restart'
export const STARTUP_STALLED_REASON =
  'startup reconcile found no live lease or resumable checkpoint'

export interface OrphanReconcileSummary {
  restartTime: string
  scanned: number
  alreadyLive: number
  resumable: RunId[]
  completedButUnrecorded: RunId[]
  deadClaim: RunId[]
  genuinelyStalled: RunId[]
  noMapping: RunId[]
  resumed: Array<{ fromRunId: RunId; toRunId: RunId }>
  stalled: RunId[]
  errors: Array<{ runId: RunId; error: string }>
  dispositions: StartupReconcileEntry[]
  dryRun: boolean
}

export interface OrphanReconcileDeps {
  runRepo: RunRepo
  taskRepo: TaskRepo
  sessionMappingRepo: SessionRunMappingRepo
  agentRepo: AgentRepo
  stateMachine: RunStateMachine
  activeSessions: Map<RunId, ActiveDispatchSession>
  evidenceRepo?: EvidenceRepo
  attemptLeaseRepo?: AttemptLeaseRepo
  runCheckpointRepo?: RunCheckpointRepo
  canSeedWorkflowStage?: boolean
  resumeRun: (runId: RunId) => Promise<Run>
  now?: () => Date
  dryRun?: boolean
}

export async function reconcileOrphanedSessions(
  deps: OrphanReconcileDeps,
): Promise<OrphanReconcileSummary> {
  const now = deps.now?.() ?? new Date()
  const summary = emptySummary(now, deps.dryRun === true)

  for (const run of deps.runRepo.getActive()) {
    summary.scanned++
    const classification = classifyStartupRun({
      sessionMappingRepo: deps.sessionMappingRepo,
      taskRepo: deps.taskRepo,
      activeSessions: deps.activeSessions,
      attemptLeaseRepo: deps.attemptLeaseRepo,
      runCheckpointRepo: deps.runCheckpointRepo,
      canSeedWorkflowStage: deps.canSeedWorkflowStage === true,
      now,
    }, run)
    addDisposition(summary, classification)

    if (summary.dryRun || classification.action === 'none' || classification.action === 'finalize') continue

    try {
      if (classification.action === 'resume-from-checkpoint') {
        stallForStartupRecovery(deps, run, STARTUP_RESUME_SCHEDULED_REASON, classification.sessionId, now)
        const resumed = await deps.resumeRun(run.id)
        classification.resumedRunId = resumed.id
        summary.resumed.push({ fromRunId: run.id, toRunId: resumed.id })
      } else {
        stallForStartupRecovery(deps, run, reasonFor(classification.disposition), classification.sessionId, now)
        summary.stalled.push(run.id)
      }
    } catch (error) {
      const msg = redactPublicText(error instanceof Error ? error.message : String(error))
      classification.error = msg
      summary.errors.push({ runId: run.id, error: msg })
      log.error('reconcile', `startup reconcile failed for ${run.id.slice(0, 8)}: ${msg}`)
    }
  }

  recordStartupReconcileEvidence(deps, summary)
  logSummary(summary)
  return summary
}

function emptySummary(restartTime: Date, dryRun: boolean): OrphanReconcileSummary {
  return {
    restartTime: restartTime.toISOString(),
    scanned: 0,
    alreadyLive: 0,
    resumable: [],
    completedButUnrecorded: [],
    deadClaim: [],
    genuinelyStalled: [],
    noMapping: [],
    resumed: [],
    stalled: [],
    errors: [],
    dispositions: [],
    dryRun,
  }
}

function addDisposition(summary: OrphanReconcileSummary, entry: StartupReconcileEntry): void {
  summary.dispositions.push(entry)
  if (entry.disposition === 'already-live') summary.alreadyLive++
  else if (entry.disposition === 'resumable') summary.resumable.push(entry.runId)
  else if (entry.disposition === 'completed-but-unrecorded') summary.completedButUnrecorded.push(entry.runId)
  else if (entry.disposition === 'dead-claim') summary.deadClaim.push(entry.runId)
  else if (entry.disposition === 'genuinely-stalled') summary.genuinelyStalled.push(entry.runId)
  else summary.noMapping.push(entry.runId)
}

function stallForStartupRecovery(
  deps: OrphanReconcileDeps,
  run: Run,
  reason: string,
  sessionId: string | undefined,
  now: Date,
): void {
  const current = deps.runRepo.get(run.id)
  if (current != null && current.terminalState == null) deps.stateMachine.markStalled(run.id)
  deps.runRepo.updateFailure(run.id, reason, true)
  if (sessionId != null) deps.sessionMappingRepo.delete(sessionId)
  deps.attemptLeaseRepo?.expireRun(run.id, now)
  log.warn('reconcile', `run ${run.id.slice(0, 8)} startup recovery: ${reason}`)
}

function reasonFor(disposition: StartupReconcileDisposition): string {
  if (disposition === 'no-mapping') return STARTUP_NO_MAPPING_REASON
  if (disposition === 'dead-claim') return STARTUP_DEAD_CLAIM_REASON
  return STARTUP_STALLED_REASON
}

function recordStartupReconcileEvidence(
  deps: OrphanReconcileDeps,
  summary: OrphanReconcileSummary,
): void {
  if (summary.dryRun || deps.evidenceRepo == null || summary.dispositions.length === 0) return
  const counts = {
    scanned: summary.scanned,
    alreadyLive: summary.alreadyLive,
    resumable: summary.resumable.length,
    completedButUnrecorded: summary.completedButUnrecorded.length,
    deadClaim: summary.deadClaim.length,
    genuinelyStalled: summary.genuinelyStalled.length,
    noMapping: summary.noMapping.length,
    resumed: summary.resumed.length,
    stalled: summary.stalled.length,
    errors: summary.errors.length,
  }
  const payload = redactPublicOutput({
    kind: 'state-reconcile',
    reason: 'startup_reconcile',
    message: 'startup state reconcile classified durable run state',
    restartTime: summary.restartTime,
    counts,
    dispositions: summary.dispositions,
    resumed: summary.resumed,
    errors: summary.errors,
  })

  for (const entry of summary.dispositions) {
    deps.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId: entry.runId,
      type: 'custom',
      payload: { ...payload, attemptId: entry.runId, disposition: entry.disposition },
    })
  }
}

function logSummary(summary: OrphanReconcileSummary): void {
  if (summary.scanned === 0) return
  log.info(
    'reconcile',
    `startup reconcile: scanned=${summary.scanned} live=${summary.alreadyLive} ` +
      `resumable=${summary.resumable.length} resumed=${summary.resumed.length} ` +
      `deadClaim=${summary.deadClaim.length} stalled=${summary.stalled.length} ` +
      `noMapping=${summary.noMapping.length} errors=${summary.errors.length}`,
  )
}
