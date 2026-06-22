import { composeAgentSystemPrompt, resolveAgentSystemPrompt } from './agent-prompt-runtime.js'
import { buildAttemptSnapshot } from './attempt-snapshot.js'
import type { AttemptLease } from './attempt-lease.js'
import { AgentRuntimeResolutionError, type AgentRuntimeResolution } from './agent-runtime-resolution.js'
import { acquireDispatchLease, attachDispatchLeaseSession, releaseDispatchLease } from './dispatcher-lease.js'
import { resolveInheritedWorktree } from './dispatcher-inherited-worktree.js'
import { resolveDispatchStart } from './dispatcher-resume.js'
import { buildDispatcherSystemPrompt, toErrorMessage, type SpawnOptions } from './dispatcher-support.js'
import type { ActiveDispatchSession, DispatchOptions } from './dispatcher-types.js'
import { DispatcherSession } from './dispatcher-session.js'
import { log } from './logger.js'
import { PrerequisiteCheckError } from './repair-dispatch.js'
import { assertPodmanHarnessSupportsContainer } from './podman-harness-support.js'
import { buildCheckpointInput } from './run-checkpoint.js'
import { createSessionControlToken } from './session-control-token.js'
import { assertSupportedSandboxRuntime, prepareSandboxRuntime, teardownSandboxRuntime, type PreparedSandboxRuntime } from './sandbox-runtime.js'
import { resolveTaskScope } from './task-scope.js'
import { createId, type Agent, type AgentId, type Run, type RunId, type Task, type TaskId } from './types.js'

interface SpawnRuntimeInput {
  run: Run; task: Task; runtime: AgentRuntimeResolution<Agent>; runtimeAgent: Agent
  baseWorkingDir: string | undefined; inheritedWorktreePaths: string[] | null; reuseRun: Run | null
  projectName: string | undefined; setupCommands: string[] | undefined
  options: DispatchOptions
}

export abstract class DispatcherSpawn extends DispatcherSession {
  async manualDispatch(taskId: TaskId, agentId: AgentId): Promise<Run> {
    const task = this.taskRepo.get(taskId)
    if (task == null) throw new Error(`Task not found: ${taskId}`)
    const agent = this.agentRepo.get(agentId)
    if (agent == null) throw new Error(`Agent not found: ${agentId}`)

    const hasActive = this.runRepo.list(taskId).some((r) => r.stage !== 'done' && r.terminalState == null)
    if (hasActive) throw new Error(`Task ${taskId} already has an active run`)

    try {
      return await this.dispatch(task, agent, this.resolveDispatchOptions(task))
    } catch (err) {
      if (err instanceof AgentRuntimeResolutionError) this.taskRepo.updateStatus(task.id, 'failed')
      throw err
    }
  }

  protected async dispatch(task: Task, agent: Agent, options: DispatchOptions = {}): Promise<Run> {
    const prerequisiteIssues = this.resolvedConfig.preDispatchCheck?.(task, agent) ?? []
    if (prerequisiteIssues.length > 0) throw new PrerequisiteCheckError(prerequisiteIssues)

    const runtime = this.resolveRuntimeAgent(task, agent)
    const runtimeAgent = runtime.agent
    if (runtimeAgent.resourceRefs?.harnessRef != null && !this.harnessAdapters.has(runtimeAgent.harness)) {
      throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} harnessRef "${runtimeAgent.resourceRefs.harnessRef}" resolved to unsupported harness: ${runtimeAgent.harness}`, 'unsupported_harness')
    }

    const reuseRun = options.reuseWorktreeFromRunId != null
      ? this.runRepo.get(options.reuseWorktreeFromRunId)
      : null
    const inheritedWorktreePaths = reuseRun?.worktreePaths ?? null
    // Resume (design/04 §1): start at the checkpoint stage on the reused worktree.
    const start = resolveDispatchStart(this.runCheckpointRepo, options)
    const scope = this.taskScopeRepos == null ? null : resolveTaskScope(task, this.taskScopeRepos)
    const baseWorkingDir = this.resolveWorkingDir(task, scope)
    const inheritedWorkflowProfile = this.resolveInheritedWorkflowProfile(options)
    const runtimeWorkflowProfile = this.materializeWorkflowProfile(task, runtimeAgent, inheritedWorkflowProfile, baseWorkingDir)
    const projectName = this.resolveProjectName(task)
    const setupCommands = projectName != null ? this.resolveSetupCommands(projectName, runtimeWorkflowProfile) : undefined
    const runId = createId<'RunId'>()
    const spec = this.specRepo.get(task.specId)
    const project = spec == null ? null : this.projectRepo.get(spec.projectId)
    this.assertSandboxRuntime(runtime, runtimeAgent, runId, task, baseWorkingDir, inheritedWorktreePaths, projectName, setupCommands)

    const run = this.runRepo.create({
      id: runId,
      taskId: task.id,
      agentId: runtimeAgent.id,
      parentRunId: options.parentRunId ?? null,
      stage: start.stage,
      terminalState: null,
      resetCount: 0,
      completedStages: start.completedStages,
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: inheritedWorktreePaths,
      runtimeModel: runtimeAgent.model,
      runtimeHarness: runtimeAgent.harness,
      runtimeSandboxProfile: runtime.sandboxProfile,
      runtimeWorkflowProfile,
      attemptSnapshot: spec == null || project == null ? null : buildAttemptSnapshot({
        task,
        spec,
        project,
        agent,
        runtime,
        workflow: runtimeWorkflowProfile,
        repository: scope?.repository ?? null,
        component: scope?.component,
        workingDir: baseWorkingDir,
        worktreePaths: inheritedWorktreePaths,
        capturedAt: this.now().toISOString(),
      }),
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: this.now().toISOString(),
      heartbeatTimeoutSeconds: this.resolvedConfig.heartbeatTimeoutSeconds,
    })
    this.resolvedRunAgents.set(run.id, runtimeAgent)
    this.taskRepo.updateStatus(task.id, 'active')

    const mcpServer = await this.createMcpServer(run.id)
    const adapter = this.harnessAdapters.get(runtimeAgent.harness)
    if (adapter == null) {
      await this.closeMcpServer(mcpServer)
      await this.markDispatchStalled(run, `No harness adapter for: ${runtimeAgent.harness}`)
      throw new Error(`No harness adapter for: ${runtimeAgent.harness}`)
    }

    let lease: AttemptLease | null = null
    let provisionalSessionId: string | null = null
    let spawnData: Awaited<ReturnType<DispatcherSpawn['prepareSpawnRuntime']>> | null = null
    let spawnedSession: { sessionId: string } | null = null
    try {
      spawnData = await this.prepareSpawnRuntime({
        run,
        task,
        runtime,
        runtimeAgent,
        baseWorkingDir,
        inheritedWorktreePaths,
        reuseRun,
        projectName,
        setupCommands,
        options,
      })
      if (start.seedStage != null) await this.resolvedConfig.seedWorkflowStage?.(run.id, start.seedStage)
      const runForSpawn = spec == null || project == null ? run : this.runRepo.updateAttemptSnapshot(run.id, buildAttemptSnapshot({
        task, spec, project, agent, runtime, workflow: runtimeWorkflowProfile,
        repository: scope?.repository ?? null, component: scope?.component,
        workingDir: spawnData.workingDir, worktreePaths: this.runRepo.get(run.id)?.worktreePaths ?? inheritedWorktreePaths,
        capturedAt: run.attemptSnapshot?.capturedAt ?? this.now().toISOString(),
      }))
      const dispatcherPrompt = this.resolvedConfig.buildSystemPrompt?.(task, runForSpawn) ?? buildDispatcherSystemPrompt(task)
      const promptRuntime = await resolveAgentSystemPrompt(runtimeAgent, spawnData.workingDir)
      if (promptRuntime != null) this.recordAgentSystemPromptEvidence(runForSpawn.id, promptRuntime)
      const systemPrompt = promptRuntime == null
        ? dispatcherPrompt
        : composeAgentSystemPrompt(promptRuntime.content, dispatcherPrompt)
      const controlToken = createSessionControlToken()
      mcpServer.setControlToken?.(controlToken)
      const agentEnv = this.resolvedConfig.materializeAgentEnv?.(runtimeAgent)
      const spawnOptions: SpawnOptions = { workingDir: spawnData.workingDir, controlToken, agent: runtimeAgent, sandbox: spawnData.sandboxRuntime, env: agentEnv?.env }
      lease = acquireDispatchLease(this.attemptLeaseRepo, runForSpawn, this.ownerProcessId, this.now())
      provisionalSessionId = `pending:${runForSpawn.id}`
      this.sessionMappingRepo.create({ sessionId: provisionalSessionId, runId: runForSpawn.id, harness: runtimeAgent.harness, controlToken, workingDir: spawnOptions.workingDir ?? null, harnessSessionId: null })
      const session = await adapter.spawn(runForSpawn, task, systemPrompt, mcpServer, spawnOptions)
      spawnedSession = session
      this.recordSandboxAgentExecutionEvidence(runForSpawn.id, spawnData.sandboxRuntime, session)
      lease = attachDispatchLeaseSession(this.attemptLeaseRepo, lease, session.sessionId)
      this.recordSpawnedSession(runForSpawn, runtimeAgent, adapter, session, mcpServer, provisionalSessionId, spawnOptions, options.reuseWorktreeFromRunId ?? null, lease)
      provisionalSessionId = null
      return runForSpawn
    } catch (error) {
      if (spawnedSession != null) await adapter.kill(spawnedSession.sessionId).catch((killError) => log.warn('dispatcher', `session kill after spawn failure failed: ${toErrorMessage(killError)}`))
      await teardownSandboxRuntime(spawnData?.sandboxRuntime).catch((teardownError) => log.warn('dispatcher', `sandbox teardown after spawn failure failed: ${toErrorMessage(teardownError)}`))
      this.resolvedRunAgents.delete(run.id)
      if (provisionalSessionId != null) this.sessionMappingRepo.delete(provisionalSessionId)
      releaseDispatchLease(this.attemptLeaseRepo, lease, this.now())
      await this.closeMcpServer(mcpServer)
      await this.markDispatchStalled(run, toErrorMessage(error))
      throw error
    }
  }

  private async prepareSpawnRuntime(input: SpawnRuntimeInput): Promise<{
    workingDir: string | undefined
    sandboxRuntime: PreparedSandboxRuntime | undefined
  }> {
    this.recordHarnessRuntimeEvidence(input.run.id, input.runtime)
    this.recordWorkflowRuntimeEvidence(input.run.id, input.run.runtimeWorkflowProfile)
    let workingDir = input.baseWorkingDir
    const worktreePaths: string[] = []
    let sandboxRuntime: PreparedSandboxRuntime | undefined
    if (input.runtime.sandboxProfile != null) {
      sandboxRuntime = await this.prepareSandbox(input, worktreePaths)
      workingDir = sandboxRuntime.workingDir
    } else if (input.inheritedWorktreePaths != null && input.inheritedWorktreePaths.length > 0) {
      workingDir = await resolveInheritedWorktree({
        baseWorkingDir: input.baseWorkingDir,
        inheritedWorktreePath: input.inheritedWorktreePaths[0]!,
        reuseRun: input.reuseRun,
        setupCommands: input.setupCommands,
        worktreeManager: this.worktreeManager,
      })
      worktreePaths.push(workingDir)
      this.runRepo.updateWorktreePaths(input.run.id, worktreePaths)
      log.info('dispatcher', `reusing worktree from run ${input.options.reuseWorktreeFromRunId?.slice(0, 6)} → ${workingDir}`)
    } else if (this.worktreeManager?.enabled && workingDir != null && this.worktreeManager.isGitRepo(workingDir)) {
      const wtPath = await this.worktreeManager.create(workingDir, input.task.name, input.run.id, input.projectName, input.setupCommands)
      if (wtPath !== workingDir) {
        worktreePaths.push(wtPath)
        workingDir = wtPath
        this.runRepo.updateWorktreePaths(input.run.id, worktreePaths)
      }
    }
    return { workingDir, sandboxRuntime }
  }
  private async prepareSandbox(
    input: SpawnRuntimeInput,
    worktreePaths: string[],
  ): Promise<PreparedSandboxRuntime> {
    const sandboxResourceSpec = input.runtime.sandboxResource?.spec as Record<string, unknown> | undefined
    if (sandboxResourceSpec == null) {
      throw new AgentRuntimeResolutionError(`Agent ${input.runtimeAgent.name} sandboxRef resolved without source resource spec`, 'resource_malformed')
    }
    const sandboxRuntime = await prepareSandboxRuntime({
      profile: input.runtime.sandboxProfile!,
      resourceSpec: sandboxResourceSpec,
      runId: input.run.id,
      taskName: input.task.name,
      baseWorkingDir: input.baseWorkingDir,
      inheritedWorktreePaths: input.inheritedWorktreePaths,
      worktreeManager: this.worktreeManager,
      projectName: input.projectName,
      setupCommands: input.setupCommands,
    })
    worktreePaths.push(...sandboxRuntime.worktreePaths)
    if (worktreePaths.length > 0) this.runRepo.updateWorktreePaths(input.run.id, worktreePaths)
    this.recordSandboxRuntimeEvidence(input.run.id, sandboxRuntime)
    return sandboxRuntime
  }

  private assertSandboxRuntime(
    runtime: AgentRuntimeResolution<Agent>,
    runtimeAgent: Agent,
    runId: Run['id'],
    task: Task,
    baseWorkingDir: string | undefined,
    inheritedWorktreePaths: string[] | null,
    projectName: string | undefined,
    setupCommands: string[] | undefined,
  ): void {
    if (runtime.sandboxProfile == null) return
    const sandboxResourceSpec = runtime.sandboxResource?.spec as Record<string, unknown> | undefined
    if (sandboxResourceSpec == null) {
      throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} sandboxRef resolved without source resource spec`, 'resource_malformed')
    }
    assertSupportedSandboxRuntime({
      profile: runtime.sandboxProfile,
      resourceSpec: sandboxResourceSpec,
      runId,
      taskName: task.name,
      baseWorkingDir,
      inheritedWorktreePaths,
      worktreeManager: this.worktreeManager,
      projectName,
      setupCommands,
    })
    assertPodmanHarnessSupportsContainer(runtime, runtimeAgent)
  }
  private recordSpawnedSession(
    run: Run, runtimeAgent: Agent, adapter: ActiveDispatchSession['adapter'], session: ActiveDispatchSession['session'],
    mcpServer: ActiveDispatchSession['mcpServer'], provisionalSessionId: string, spawnOptions: SpawnOptions, reusedRunId: RunId | null,
    lease: AttemptLease | null,
  ): void {
    this.sessionMappingRepo.updateSessionId(provisionalSessionId, session.sessionId, session.harnessSessionId?.trim() === '' ? null : (session.harnessSessionId?.trim() ?? null))
    this.runRepo.updateSession(run.id, session.sessionId)
    if (reusedRunId != null || run.stage !== 'understand') {
      const checkpoint = buildCheckpointInput(run)
      if (lease?.fenceToken != null && this.runCheckpointRepo?.upsertFenced != null) {
        this.runCheckpointRepo.upsertFenced(checkpoint, lease.fenceToken, this.now())
      } else {
        this.runCheckpointRepo?.upsert(checkpoint)
      }
      if (reusedRunId != null && reusedRunId !== run.id) this.runCheckpointRepo?.delete(reusedRunId)
    }
    const active: ActiveDispatchSession = { agentId: runtimeAgent.id, agent: runtimeAgent, adapter, session, mcpServer, sandboxRuntime: spawnOptions.sandbox, released: false, lease }
    this.activeSessions.set(run.id, active)
    void session.waitForCompletion()
      .then(async (completion) => {
        log.info('dispatcher', `session ${session.sessionId} completed: ${completion.exitReason}`)
        await this.handleSessionEnd(run.id, completion)
      }, async (error) => {
        const msg = error instanceof Error ? error.stack ?? error.message : String(error)
        log.error('dispatcher', `session ${session.sessionId} crashed: ${msg}`)
        await this.handleSessionEnd(run.id, { exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0, failReason: msg })
      })
      .catch((error) => log.error('dispatcher', `completion handling failed for session ${session.sessionId}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`))

    this.eventEmitter.emit({ type: 'run.dispatched', runId: run.id, taskId: run.taskId, agentId: runtimeAgent.id, agentName: runtimeAgent.name, stage: run.stage })
  }
}
