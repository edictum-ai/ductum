import {
  Session,
  WorkflowRuntime,
  createEnvelope,
  type WorkflowDefinition,
  type WorkflowState,
} from '@edictum/core'

import { DuctumEventEmitter } from './events.js'
import type { FencingToken } from './attempt-lease.js'
import { deriveShipState, isExternalReviewRequired } from './external-review-gate.js'
import { log } from './logger.js'
import type { SqliteStorageBackend } from './edictum-storage.js'
import type { AsyncTransactionRunner } from './sqlite-transaction.js'
import type {
  EvidenceRepo,
  GateEvaluationRepo,
  ProjectRepo,
  RepositoryRepo,
  RunRepo,
  SessionRunMappingRepo,
  SpecRepo,
  TaskRepo,
} from './repos/interfaces.js'
import { RunStateMachine } from './state-machine.js'
import { createId, type Evidence, type GateType, type MergeMode, type Run, type RunId } from './types.js'
import { WorkflowDefinitionResolver } from './workflow-definition-resolver.js'
import { advanceWorkflowAfterRecordedSuccess } from './workflow-recorded-success.js'
import {
  normalizeWorkflowToolArgs,
  validateWorkflowToolCommandScope,
  validateWorkflowToolPathScope,
} from './workflow-tool-args.js'

export interface EnforcementManagerOptions {
  workflowDefsByProjectName?: ReadonlyMap<string, WorkflowDefinition>
  fallbackWorkflowPath: string
  templateWorkflowPath: string
  storageBackend: SqliteStorageBackend
  projectRepo: ProjectRepo
  repositoryRepo?: RepositoryRepo
  runRepo: RunRepo
  sessionRunMappingRepo: SessionRunMappingRepo
  specRepo: SpecRepo
  taskRepo: TaskRepo
  evidenceRepo: EvidenceRepo
  gateEvaluationRepo: GateEvaluationRepo
  stateMachine: RunStateMachine
  eventEmitter: DuctumEventEmitter
  mergeMode?: MergeMode
  /**
   * Observer mode (Priority 3). When true, every tool call is still
   * evaluated against the Edictum workflow runtime and the would-have-
   * been decision is recorded in gate_evaluations with observed=1,
   * but `authorizeTool` returns allowed=true to the caller regardless
   * of the actual rule result. Useful for:
   *  - Debugging workflow advancement without blocking real work
   *  - Validating profile changes by replaying runs
   *  - Procurement/pilot demos ("show me what it WOULD have done")
   *  - New project onboarding (first N dispatches in dry-run)
   *
   * Default: false (enforcement on).
   */
  observerMode?: boolean
  /**
   * Absolute factory-owned paths that managed shell commands may not
   * access directly. This is a structural control-plane boundary: agents
   * must use Ductum CLI/API flows for live factory state, not sqlite3/cat/cp.
   */
  protectedShellPaths?: readonly string[]
  gateCommitTransaction?: AsyncTransactionRunner
}

interface ResetToStageOptions {
  maxResets?: number
  reason?: string
  fenceToken?: FencingToken
  fenceNow?: Date
}

interface FencedOperationOptions {
  fenceToken?: FencingToken
  fenceNow?: Date
}

function describeSupportedReadRecovery(
  exits: ReadonlyArray<string | { condition?: string; message?: string }> | undefined,
): string | null {
  const files = (exits ?? [])
    .map((exit) => typeof exit === 'string' ? exit : exit.condition)
    .map((condition) => condition?.match(/^file_read\("(.+)"\)$/)?.[1] ?? null)
    .filter((file): file is string => file != null)
  if (files.length === 0) return null
  const supportedReads = files.map((file) => `Read ${file}`)
  return `To continue, perform a supported local repo read: ${supportedReads.join(' or ')}.`
}

export class EnforcementManager {
  private readonly runtimes = new Map<RunId, WorkflowRuntime>()
  private readonly definitions: WorkflowDefinitionResolver

  constructor(private readonly options: EnforcementManagerOptions) {
    this.definitions = new WorkflowDefinitionResolver({
      fallbackWorkflowPath: options.fallbackWorkflowPath,
      templateWorkflowPath: options.templateWorkflowPath,
      workflowDefsByProjectName: options.workflowDefsByProjectName,
      runRepo: options.runRepo,
      taskRepo: options.taskRepo,
      specRepo: options.specRepo,
      projectRepo: options.projectRepo,
      repositoryRepo: options.repositoryRepo,
    })
  }

  async initialize(): Promise<void> {
    this.definitions.initialize()
  }

  getRuntime(runId: RunId): WorkflowRuntime {
    let runtime = this.runtimes.get(runId)
    if (runtime == null) {
      runtime = new WorkflowRuntime(this.definitions.getForRun(runId))
      this.runtimes.set(runId, runtime)
    }
    return runtime
  }

  disposeRuntime(runId: RunId): void {
    this.runtimes.delete(runId)
  }

  /**
   * Authorize a tool call — evaluate directly against Edictum workflow.
   * No sync needed: the workflow IS the source of truth.
   *
   * In observer mode (EnforcementManagerOptions.observerMode=true) the
   * evaluation still runs — so we can record the would-have-been
   * result in gate_evaluations with observed=1 — but the return value
   * is always `{ allowed: true }` so the agent isn't actually blocked.
   * Terminal state and done-stage blocks are honored even under
   * observer mode because allowing tools on a finished run would
   * corrupt workflow state, not just log a dry-run decision.
   */
  async authorizeTool(
    runId: RunId,
    toolName: string,
    toolArgs: Record<string, unknown>,
    options: FencedOperationOptions = {},
  ): Promise<{ allowed: boolean; reason?: string }> {
    return await this.commitGate(async () => {
      const run = this.requireRun(runId)

      // Terminal states block all tools — NOT overridable by observer mode.
      if (run.terminalState != null) {
        return await this.finishEvaluation(
          runId,
          'authorize_tool',
          toolName,
          false,
          `Tool calls are blocked: run is ${run.terminalState}`,
          false,
        )
      }

      // Done stage blocks all tools — NOT overridable by observer mode.
      if (run.stage === 'done') {
        return await this.finishEvaluation(
          runId,
          'authorize_tool',
          toolName,
          false,
          'Tool calls are blocked: run is done',
          false,
        )
      }

      const runtime = this.getRuntime(runId)
      const baseDir = this.resolveRunBaseDir(runId, run)
      const pathScope = validateWorkflowToolPathScope(toolName, toolArgs, { baseDir })
      if (!pathScope.allowed) {
        this.recordBlockedToolEvidence(runId, 'tool.path_blocked', toolName, toolArgs, baseDir, pathScope.reason, options)
        this.options.runRepo.updateWorkflowState(runId, {
          blockedReason: pathScope.reason ?? null,
        })
        return await this.finishEvaluation(
          runId,
          'authorize_tool',
          toolName,
          false,
          pathScope.reason,
          false,
        )
      }

      const commandScope = validateWorkflowToolCommandScope(toolName, toolArgs, {
        activeStage: run.stage,
        allowShellFileMutation: this.stageAllowsShellFileMutation(runtime, run.stage),
        baseDir,
        protectedPaths: this.options.protectedShellPaths,
      })
      if (!commandScope.allowed) {
        this.recordBlockedToolEvidence(runId, 'tool.command_blocked', toolName, toolArgs, baseDir, commandScope.reason, options)
        this.options.runRepo.updateWorkflowState(runId, {
          blockedReason: commandScope.reason ?? null,
        })
        return await this.finishEvaluation(
          runId,
          'authorize_tool',
          toolName,
          false,
          commandScope.reason,
          false,
        )
      }

      const normalizedArgs = normalizeWorkflowToolArgs(toolName, toolArgs, { baseDir })
      const session = this.getSession(runId)
      const evaluation = await runtime.evaluate(
        session,
        createEnvelope(toolName, normalizedArgs, { runId }),
      )

      const stateAfter = await runtime.state(session)
      this.refreshRunFromWorkflow(runId, run, stateAfter, undefined, options)

      // Provide a clear, actionable block message when a tool isn't allowed in the current stage.
      // Edictum returns exit gate messages (e.g., "Read README.md before editing") even when
      // the real issue is the tool itself is not in the stage's allowed list.
      let reason = evaluation.reason || undefined
      if (evaluation.action !== 'allow' && reason != null) {
        const activeStage = (stateAfter.activeStage || run.stage) as string
        const stageDef = runtime.definition.stages.find((s) => s.id === activeStage)
        if (stageDef != null && stageDef.tools.length > 0 && !stageDef.tools.includes(toolName)) {
          reason = `${toolName} is not allowed in stage "${activeStage}". Allowed tools: ${stageDef.tools.join(', ')}. ${reason}`
          const recoveryAction = describeSupportedReadRecovery(stageDef.exit)
          if (recoveryAction != null) reason = `${reason} ${recoveryAction}`
        }
      }

      const realAllowed = evaluation.action === 'allow'
      const observer = this.options.observerMode === true
      if (!realAllowed) {
        this.options.runRepo.updateWorkflowState(runId, {
          blockedReason: observer
            ? run.blockedReason
            : reason ?? evaluation.reason ?? 'Tool call blocked',
        })
      }

      // Record the real workflow decision (and observed flag) but force
      // allowed=true back to the caller when observer mode is on. The
      // caller's return path uses the observer flag directly; the gate
      // evaluation row captures the un-overridden decision so operators
      // can see what WOULD have happened.
      return await this.finishEvaluation(
        runId,
        'authorize_tool',
        toolName,
        realAllowed,
        reason,
        observer,
      )
    })
  }

  /**
   * Record a successful tool execution — records evidence, auto-advances workflow,
   * then refreshes the Run's stage from Edictum state.
   */
  async recordToolSuccess(
    runId: RunId,
    toolName: string,
    toolArgs: Record<string, unknown>,
    options: FencedOperationOptions = {},
  ): Promise<void> {
    const result = await this.commitGate(async () => {
      const run = this.options.runRepo.get(runId)
      if (run == null || run.terminalState != null || run.stage === 'done') {
        return null
      }

      const runtime = this.getRuntime(runId)
      const session = this.getSession(runId)
      const stateBefore = await runtime.state(session)
      const currentStage = stateBefore.activeStage

      if (currentStage === 'done' || currentStage == null || currentStage === '') {
        return null
      }

      // Resolve base dir for path normalization — try session mapping first, then worktree paths
      const baseDir = this.resolveRunBaseDir(runId, run)

      const normalizedArgs = normalizeWorkflowToolArgs(toolName, toolArgs, { baseDir })
      log.info('enforce', `recordToolSuccess: run=${runId} tool=${toolName} stage=${currentStage} baseDir=${baseDir} args=${JSON.stringify(normalizedArgs).slice(0, 100)}`)

      const envelope = createEnvelope(
        toolName,
        normalizedArgs,
        { runId },
      )
      const events = await runtime.recordResult(session, currentStage, envelope)
      const midState = await runtime.state(session)
      log.info('enforce', `after recordResult: stage=${midState.activeStage} evidence.reads=${JSON.stringify(midState.evidence?.reads?.slice(0,3))}`)

      const immediateAdvanceEvents = await advanceWorkflowAfterRecordedSuccess(runtime, session, envelope)
      const allEvents = [...events, ...immediateAdvanceEvents]

      const stateAfter = await runtime.state(session)
      log.info('enforce', `recordToolSuccess: run=${runId} tool=${toolName} stage=${currentStage}→${stateAfter.activeStage} advanceEvents=${immediateAdvanceEvents.length}`)
      this.refreshRunFromWorkflow(runId, run, stateAfter, undefined, options)
      return { currentStage, allEvents }
    })

    if (result != null && result.allEvents.length > 0) {
      this.options.eventEmitter.emit({
        type: 'workflow.advanced',
        runId,
        fromStage: result.currentStage,
        events: result.allEvents,
      })
    }
  }

  /**
   * Get current workflow state for a run.
   * gate_check is now a read-only status query, not a transition.
   */
  async getWorkflowState(runId: RunId): Promise<WorkflowState> {
    this.requireRun(runId)
    const runtime = this.getRuntime(runId)
    const state = await runtime.state(this.getSession(runId))
    return this.applyDerivedWorkflowState(runId, runtime, state)
  }

  /**
   * Get the full workflow info for an agent — current state + stage definitions.
   * Agents call this to understand the rules before starting work.
   */
  async getWorkflowInfo(runId: RunId): Promise<{
    activeStage: string
    completedStages: string[]
    stages: Array<{
      id: string
      tools: string[]
      exit: Array<{ condition: string; message?: string }>
      approval?: { message: string }
    }>
  }> {
    this.requireRun(runId)
    const runtime = this.getRuntime(runId)
    const state = await runtime.state(this.getSession(runId))
    const def = runtime.definition

    return {
      activeStage: state.activeStage,
      completedStages: [...state.completedStages],
      stages: def.stages.map((s) => ({
        id: s.id,
        tools: s.tools ?? [],
        exit: (s.exit ?? []).map((e) => ({
          condition: typeof e === 'string' ? e : (e as unknown as Record<string, unknown>).condition as string ?? '',
          message: typeof e === 'string' ? undefined : (e as unknown as Record<string, unknown>).message as string | undefined,
        })),
        ...(s.approval != null ? { approval: { message: String((s.approval as unknown as Record<string, unknown>).message ?? 'Approval required') } } : {}),
      })),
    }
  }

  /**
   * Record approval for the current stage (dashboard calls this).
   */
  async recordApproval(runId: RunId, options: FencedOperationOptions = {}): Promise<void> {
    await this.commitGate(async () => {
      const run = this.requireRun(runId)
      const runtime = this.getRuntime(runId)
      const session = this.getSession(runId)
      const state = await runtime.state(session)
      const pendingApproval = this.resolvePendingApproval(runtime, state)

      if (!pendingApproval.required) {
        throw new Error(`Run ${runId} does not require approval`)
      }

      await runtime.recordApproval(session, state.activeStage)

      // Refresh state after approval — may trigger advancement
      const stateAfter = await runtime.state(session)
      this.refreshRunFromWorkflow(runId, run, stateAfter, undefined, options)
    })
  }

  /**
   * Move a run to a named stage under factory control.
   */
  async advanceToStage(runId: RunId, targetStage: string, options: FencedOperationOptions = {}): Promise<void> {
    await this.commitGate(async () => {
      const run = this.requireRun(runId)
      const runtime = this.getRuntime(runId)
      const session = this.getSession(runId)

      await runtime.setStage(session, targetStage)

      const stateAfter = await runtime.state(session)
      this.refreshRunFromWorkflow(runId, run, stateAfter, undefined, options)
    })
  }

  /**
   * Reset workflow to a target stage (review/CI failure).
   */
  async resetToStage(
    runId: RunId,
    targetStage: string,
    options: ResetToStageOptions | number = 5,
  ): Promise<void> {
    await this.commitGate(async () => {
      const run = this.requireRun(runId)
      const maxResets = typeof options === 'number' ? options : options.maxResets ?? 5
      const reason = typeof options === 'number' ? undefined : options.reason

      // Max reset limit — after N resets, mark run as failed
      if (run.resetCount >= maxResets) {
        this.options.stateMachine.markFailed(runId, `Max reset limit (${maxResets}) exceeded`, {
          fenceToken: typeof options === 'number' ? undefined : options.fenceToken,
          fenceNow: typeof options === 'number' ? undefined : options.fenceNow,
        })
        return
      }

      const runtime = this.getRuntime(runId)
      const session = this.getSession(runId)

      await runtime.reset(session, targetStage)
      this.options.runRepo.incrementResetCount(runId)

      const stateAfter = await runtime.state(session)
      this.refreshRunFromWorkflow(runId, run, stateAfter, reason, typeof options === 'number' ? {} : options)
    })
  }

  isExternalReviewRequired(runId: RunId): boolean {
    const run = this.requireRun(runId)
    return isExternalReviewRequired(
      {
        projectRepo: this.options.projectRepo,
        specRepo: this.options.specRepo,
        taskRepo: this.options.taskRepo,
      },
      run,
    )
  }

  async syncRunState(runId: RunId, options: FencedOperationOptions = {}): Promise<Run> {
    const run = this.requireRun(runId)
    const runtime = this.getRuntime(runId)
    const state = await runtime.state(this.getSession(runId))
    this.refreshRunFromWorkflow(runId, run, state, undefined, options)
    return this.requireRun(runId)
  }

  /**
   * Sync the Run record from Edictum's workflow state.
   * Called after recordResult, approval, or reset.
   *
   * Priority 7 guard: if the run is already at `'done'` (the DB's
   * terminal stage, set by `mergeApprovedRun.markDone`) we must NEVER
   * regress it to an earlier stage based on Edictum's view of the
   * workflow. Edictum's activeStage often still reads 'ship' at the
   * moment approveRun runs because the merge + markDone happens
   * entirely on the DB side and Edictum's workflow state isn't
   * notified via its own setStage path. Without this guard, the
   * trailing `enforcement.recordApproval` in approveRun would
   * downgrade stage='done' back to stage='ship', leaving the run
   * stuck in the dashboard with terminal_state=null after the git
   * merge already landed.
   */
  private refreshRunFromWorkflow(
    runId: RunId,
    previousRun: Run,
    state: WorkflowState,
    transitionReason?: string,
    options: FencedOperationOptions = {},
  ): void {
    const currentRun = this.options.runRepo.get(runId) ?? previousRun
    if (currentRun.stage === 'done') {
      // The run has already been terminated on the DB side. Skip both
      // the stage update and the pendingApproval refresh — both would
      // reopen a completed run and break the dashboard's "done" badge.
      return
    }

    const newStage = state.activeStage as Run['stage']
    const runtime = this.getRuntime(runId)
    const pendingApproval = this.resolvePendingApproval(runtime, state)
    const nextPendingApproval = pendingApproval.required === true

    // Update stage if changed
    if (newStage !== currentRun.stage && newStage != null && (newStage as string) !== '') {
      this.options.runRepo.updateStage(runId, newStage)
      this.options.stateMachine.recordStageAdvance(runId, currentRun.stage, newStage, transitionReason, options)
    }

    const derived = deriveShipState(
      {
        projectRepo: this.options.projectRepo,
        runRepo: this.options.runRepo,
        specRepo: this.options.specRepo,
        taskRepo: this.options.taskRepo,
      },
      runId,
      {
        blockedReason:
          (state as unknown as Record<string, unknown>).blockedReason as string | null ?? null,
        pendingApproval: nextPendingApproval,
      },
    )

    // Update workflow metadata
    this.options.runRepo.updateWorkflowState(runId, {
      completedStages: [...state.completedStages],
      blockedReason: derived.blockedReason,
      pendingApproval: derived.pendingApproval,
    })

    if (!currentRun.pendingApproval && derived.pendingApproval) {
      this.options.eventEmitter.emit({
        type: 'run.awaiting_approval',
        runId,
      })
      this.options.eventEmitter.emit({
        type: 'approval.requested',
        runId,
      })
    }
  }

  private applyDerivedWorkflowState(
    runId: RunId,
    runtime: WorkflowRuntime,
    state: WorkflowState,
  ): WorkflowState {
    const basePendingApproval = this.resolvePendingApproval(runtime, state)
    const persistedRun = this.options.runRepo.get(runId)
    const stateBlockedReason =
      (state as unknown as Record<string, unknown>).blockedReason as string | null ?? null
    const baseBlockedReason = persistedRun == null
      ? stateBlockedReason
      : persistedRun.blockedReason
    const derived = deriveShipState(
      {
        projectRepo: this.options.projectRepo,
        runRepo: this.options.runRepo,
        specRepo: this.options.specRepo,
        taskRepo: this.options.taskRepo,
      },
      runId,
      {
        blockedReason: baseBlockedReason,
        pendingApproval: basePendingApproval.required === true,
      },
    )
    const nextState = {
      ...state,
      pendingApproval:
        derived.pendingApproval
          ? basePendingApproval
          : this.clearPendingApproval(basePendingApproval, derived.blockedReason),
    } as WorkflowState & { blockedReason?: string | null }
    nextState.blockedReason = derived.blockedReason
    return nextState
  }

  /**
   * Ensure pendingApproval reflects the active stage's approval requirement.
   * @edictum/core 0.4.1+ hydrates this in setStage(), but we keep this as
   * a defensive fallback to guarantee the dashboard always shows it.
   */
  private resolvePendingApproval(
    runtime: WorkflowRuntime,
    state: WorkflowState,
  ): WorkflowState['pendingApproval'] {
    if (state.pendingApproval.required) {
      return state.pendingApproval
    }

    const activeStage = runtime.definition.stages.find((stage) => stage.id === state.activeStage) ?? null
    if (activeStage?.approval == null) {
      return state.pendingApproval
    }

    if (state.approvals[activeStage.id] === 'approved') {
      return state.pendingApproval
    }

    return {
      required: true,
      stageId: activeStage.id,
      message: activeStage.approval.message,
    }
  }

  private clearPendingApproval(
    pendingApproval: WorkflowState['pendingApproval'],
    message: string | null,
  ): WorkflowState['pendingApproval'] {
    return {
      required: false,
      stageId: pendingApproval.stageId,
      message: message ?? pendingApproval.message,
    }
  }

  private stageAllowsShellFileMutation(runtime: WorkflowRuntime, stageId: string): boolean {
    const tools = runtime.definition.stages.find((stage) => stage.id === stageId)?.tools ?? []
    return tools.some((tool) => tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit' || tool === 'MultiEdit')
  }

  private resolveRunBaseDir(runId: RunId, run: Run): string | null {
    return this.options.sessionRunMappingRepo.getByRunId(runId)?.workingDir ?? run.worktreePaths?.[0] ?? null
  }

  private recordBlockedToolEvidence(
    runId: RunId,
    kind: 'tool.path_blocked' | 'tool.command_blocked',
    toolName: string,
    toolArgs: Record<string, unknown>,
    baseDir: string | null,
    reason?: string,
    options: FencedOperationOptions = {},
  ): void {
    const evidence = {
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: {
        kind,
        toolName,
        baseDir,
        reason: reason ?? null,
        args: normalizeWorkflowToolArgs(toolName, toolArgs, { baseDir }),
      },
    } as const
    this.createEvidence(evidence, options.fenceToken, options.fenceNow)
  }

  private createEvidence(evidence: Omit<Evidence, 'createdAt'>, fenceToken?: FencingToken, fenceNow?: Date): Evidence {
    return fenceToken != null && this.options.evidenceRepo.createFenced != null
      ? this.options.evidenceRepo.createFenced(evidence, fenceToken, fenceNow)
      : this.options.evidenceRepo.create(evidence)
  }

  private async finishEvaluation(
    runId: RunId,
    gateType: GateType,
    target: string,
    allowed: boolean,
    reason?: string,
    observer = false,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Record the REAL workflow decision (allowed/blocked) with the
    // observer flag set appropriately. Observer-mode recordings let
    // operators query `WHERE observed = 1` to see the dry-run view.
    this.options.gateEvaluationRepo.create({
      runId,
      gateType,
      target,
      result: allowed ? 'allowed' : 'blocked',
      reason: reason ?? null,
      observed: observer,
    })
    this.options.eventEmitter.emit({
      type: 'gate.evaluated',
      runId,
      gateType,
      result: allowed ? 'allowed' : 'blocked',
    })
    // Observer mode always returns allowed=true to the caller so the
    // agent isn't actually blocked. The dry-run decision still lives
    // in gate_evaluations for inspection. Reason is preserved so the
    // dashboard can show it alongside the observed row.
    if (observer) {
      return { allowed: true, reason }
    }
    return allowed ? { allowed: true, reason } : { allowed: false, reason }
  }

  private async commitGate<T>(operation: () => Promise<T>): Promise<T> {
    return this.options.gateCommitTransaction == null
      ? await operation()
      : await this.options.gateCommitTransaction.run(operation)
  }

  private getSession(runId: RunId): Session {
    return new Session(runId, this.options.storageBackend)
  }

  private requireRun(runId: RunId): Run {
    const run = this.options.runRepo.get(runId)
    if (run == null) {
      throw new Error(`Run not found: ${runId}`)
    }
    return run
  }
}
