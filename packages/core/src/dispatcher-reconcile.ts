import type {
  ActiveDispatchSession,
} from './dispatcher-types.js'
import type {
  DispatcherMcpServer,
  HarnessAdapter,
  HarnessSession,
  ReattachContext,
} from './dispatcher-support.js'
import { log } from './logger.js'
import { redactPublicOutput, redactPublicText } from './public-redaction.js'
import type {
  AgentRepo,
  EvidenceRepo,
  RunRepo,
  SessionRunMappingRepo,
  TaskRepo,
} from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import { createId, type Agent, type AgentId, type Run, type RunId } from './types.js'
import { isWorkflowOwnedRun } from './workflow-owned-run.js'

/**
 * Decision 121 (P3.1): the explicit reason planted on any active run
 * whose harness adapter cannot reattach across a `pnpm serve` restart.
 * Operators see this string verbatim in the run's failReason and in
 * the `ductum status` output, so it must stay stable for log greps.
 */
export const ORPHANED_REATTACH_FAILURE_REASON =
  'harness session not reattachable across server restart'
export const ORPHANED_NO_MAPPING_FAILURE_REASON =
  'harness session mapping missing across server restart'

export interface OrphanReconcileSummary {
  /** Server restart/reconcile time. */
  restartTime: string
  /** Total active (non-terminal) runs scanned. */
  scanned: number
  /** Runs with an existing live `activeSessions` entry — never disturbed. */
  alreadyLive: number
  /** Runs successfully reattached via adapter.tryReattach. */
  reattached: RunId[]
  /** Runs marked stalled because the adapter cannot reattach. */
  stalled: RunId[]
  /** Runs skipped because no session mapping was on disk. */
  noMapping: RunId[]
  /** Runs whose adapter is no longer registered. */
  noAdapter: RunId[]
  /** Reattach attempts that threw — fall back to stalled. */
  errors: Array<{ runId: RunId; error: string }>
  /** Explicit stalled reasons planted during this restart reconcile. */
  stalledReasons: Array<{ runId: RunId; reason: string }>
}

export interface OrphanReconcileDeps {
  runRepo: RunRepo
  taskRepo: TaskRepo
  sessionMappingRepo: SessionRunMappingRepo
  agentRepo: AgentRepo
  stateMachine: RunStateMachine
  harnessAdapters: Map<string, HarnessAdapter>
  activeSessions: Map<RunId, ActiveDispatchSession>
  evidenceRepo?: EvidenceRepo
  resolveRuntimeAgentForRun: (run: Run) => Agent | null
  createMcpServer: (runId: RunId) => Promise<DispatcherMcpServer>
  closeMcpServer: (mcp: DispatcherMcpServer) => Promise<void>
  /** Same hook the dispatcher uses to drive post-completion routing. */
  onSessionEnd: (runId: RunId, sessionId: string, ok: boolean) => void
  now?: () => Date
}

/**
 * Walk every active run on startup and either reattach to its live
 * harness session or mark it stalled with the explicit reason. The
 * reconciler is idempotent — calling it twice is a no-op past the
 * first reattach pass because `alreadyLive` short-circuits.
 *
 * D27 holds: each reattached run gets its own MCP server and (later)
 * its own per-run WorkflowRuntime when the dispatcher routes the
 * session-end event. We never share runtimes across runs.
 */
export async function reconcileOrphanedSessions(
  deps: OrphanReconcileDeps,
): Promise<OrphanReconcileSummary> {
  const summary: OrphanReconcileSummary = {
    restartTime: (deps.now?.() ?? new Date()).toISOString(),
    scanned: 0,
    alreadyLive: 0,
    reattached: [],
    stalled: [],
    noMapping: [],
    noAdapter: [],
    errors: [],
    stalledReasons: [],
  }

  const activeRuns = deps.runRepo.getActive()
  for (const run of activeRuns) {
    summary.scanned++

    if (deps.activeSessions.has(run.id)) {
      summary.alreadyLive++
      continue
    }

    if (isWorkflowOwnedRun(run, deps.taskRepo)) {
      continue
    }

    const mapping = deps.sessionMappingRepo.getByRunId(run.id)
    if (mapping == null) {
      summary.noMapping.push(run.id)
      await stallOrphan(deps, summary, run, ORPHANED_NO_MAPPING_FAILURE_REASON, run.sessionId ?? run.id)
      summary.stalled.push(run.id)
      continue
    }

    const adapter = deps.harnessAdapters.get(mapping.harness)
    if (adapter == null) {
      summary.noAdapter.push(run.id)
      await stallOrphan(deps, summary, run, `${ORPHANED_REATTACH_FAILURE_REASON} (no adapter for ${mapping.harness})`, mapping.sessionId)
      summary.stalled.push(run.id)
      continue
    }

    if (mapping.harnessSessionId == null || mapping.harnessSessionId === '') {
      // Adapter never reported a stable session id, so reattach has
      // nothing to anchor on — treat as unreattachable.
      await stallOrphan(deps, summary, run, ORPHANED_REATTACH_FAILURE_REASON, mapping.sessionId)
      summary.stalled.push(run.id)
      continue
    }

    if (adapter.tryReattach == null) {
      await stallOrphan(deps, summary, run, ORPHANED_REATTACH_FAILURE_REASON, mapping.sessionId)
      summary.stalled.push(run.id)
      continue
    }

    let mcpServer: DispatcherMcpServer | null = null
    try {
      const agent = deps.resolveRuntimeAgentForRun(run) ?? deps.agentRepo.get(run.agentId)
      mcpServer = await deps.createMcpServer(run.id)
      const ctx: ReattachContext = {
        runId: run.id,
        harnessSessionId: mapping.harnessSessionId,
        workingDir: mapping.workingDir ?? null,
        controlToken: mapping.controlToken,
        mcpServer,
        ...(agent != null ? { agent } : {}),
      }
      const session = await adapter.tryReattach(ctx)
      if (session == null) {
        await deps.closeMcpServer(mcpServer)
        await stallOrphan(deps, summary, run, ORPHANED_REATTACH_FAILURE_REASON, mapping.sessionId)
        summary.stalled.push(run.id)
        continue
      }
      registerReattachedSession(deps, run, agent, adapter, session, mcpServer)
      summary.reattached.push(run.id)
    } catch (error) {
      const msg = redactPublicText(error instanceof Error ? error.message : String(error))
      if (mcpServer != null) await deps.closeMcpServer(mcpServer).catch(() => undefined)
      summary.errors.push({ runId: run.id, error: msg })
      await stallOrphan(deps, summary, run, `${ORPHANED_REATTACH_FAILURE_REASON} (reattach error: ${msg})`, mapping.sessionId)
      summary.stalled.push(run.id)
    }
  }

  if (
    summary.reattached.length > 0 ||
    summary.stalled.length > 0 ||
    summary.errors.length > 0
  ) {
    log.info(
      'reconcile',
      `orphan reconcile: ${summary.alreadyLive} live, ${summary.reattached.length} reattached, ` +
        `${summary.stalled.length} stalled, ${summary.noMapping.length} no-mapping, ` +
        `${summary.errors.length} errors`,
    )
  }
  recordStartupReconcileEvidence(deps, summary)
  return summary
}

function registerReattachedSession(
  deps: OrphanReconcileDeps,
  run: Run,
  agent: Agent | null,
  adapter: HarnessAdapter,
  session: HarnessSession,
  mcpServer: DispatcherMcpServer,
): void {
  const agentId = (agent?.id ?? run.agentId) as AgentId
  const reattachedAgent: Agent = agent ?? ({
    id: agentId,
  } as Agent)
  const active: ActiveDispatchSession = {
    agentId,
    agent: reattachedAgent,
    adapter,
    session,
    mcpServer,
    released: false,
  }
  deps.activeSessions.set(run.id, active)
  void session.waitForCompletion()
    .then(() => deps.onSessionEnd(run.id, session.sessionId, true))
    .catch((error) => {
      log.error(
        'reconcile',
        `reattached session ${session.sessionId} crashed: ${error instanceof Error ? error.message : String(error)}`,
      )
      deps.onSessionEnd(run.id, session.sessionId, false)
    })
  log.info('reconcile', `run ${run.id.slice(0, 8)} reattached to harness session ${session.sessionId.slice(0, 16)}`)
}

async function stallOrphan(
  deps: OrphanReconcileDeps,
  summary: OrphanReconcileSummary,
  run: Run,
  reason: string,
  sessionId: string,
): Promise<void> {
  if (run.terminalState != null) return
  deps.stateMachine.markStalled(run.id)
  deps.runRepo.updateFailure(run.id, reason, true)
  summary.stalledReasons.push({ runId: run.id, reason: redactPublicText(reason) })
  // Drop the stale mapping so a subsequent dispatch (operator-driven
  // retry) doesn't rebind to a dead session id.
  deps.sessionMappingRepo.delete(sessionId)
  log.warn(
    'reconcile',
    `run ${run.id.slice(0, 8)} stalled on startup — ${reason}`,
  )
}

function recordStartupReconcileEvidence(
  deps: OrphanReconcileDeps,
  summary: OrphanReconcileSummary,
): void {
  if (deps.evidenceRepo == null) return
  const affectedAttemptIds = [
    ...new Set<RunId>([
      ...summary.reattached,
      ...summary.stalled,
      ...summary.noMapping,
      ...summary.noAdapter,
      ...summary.errors.map((entry) => entry.runId),
    ]),
  ]
  if (affectedAttemptIds.length === 0) return

  const payload = redactPublicOutput({
    kind: 'state-reconcile',
    reason: 'startup_orphan_sessions',
    message: 'startup orphan session reconcile',
    restartTime: summary.restartTime,
    counts: {
      scanned: summary.scanned,
      live: summary.alreadyLive,
      reattached: summary.reattached.length,
      stalled: summary.stalled.length,
      noMapping: summary.noMapping.length,
      noAdapter: summary.noAdapter.length,
      errors: summary.errors.length,
    },
    affectedAttemptIds,
    reattachedAttemptIds: summary.reattached,
    stalledAttemptIds: summary.stalled,
    noMappingAttemptIds: summary.noMapping,
    noAdapterAttemptIds: summary.noAdapter,
    errors: summary.errors,
    stalledReasons: summary.stalledReasons,
  })

  for (const runId of affectedAttemptIds) {
    deps.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: { ...payload, attemptId: runId },
    })
  }
}
