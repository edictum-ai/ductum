import {
  AgentRuntimeResolutionError,
  assertSupportedSandboxProfileSpec,
  applyWorkflowProfileRuntimeData,
  buildAttemptSnapshot,
  createId,
  requireMaterializedWorkflowProfile,
  resolveAgentRuntimeDetails,
  resolveAgentWorkflowProfile,
  resolveTaskScope,
  type Run,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'
import { isActiveRun, requireTask, toErrorMessage } from './common.js'

export function acceptRun(
  context: ApiContext,
  input: {
    taskId: string
    agentId?: string | null
    parentRunId?: string | null
    sessionId?: string | null
    heartbeatTimeoutSeconds?: number
  },
) {
  const task = requireTask(context, input.taskId)

  const agentId = input.agentId ?? task.assignedAgentId
  if (agentId == null) {
    throw new ValidationError(`No agent specified and task ${task.id} has no assigned agent`)
  }
  const agent = context.repos.agents.get(agentId as Run['agentId'])
  if (agent == null) throw new NotFoundError(`Agent not found: ${agentId}`)

  const hasActiveRun = context.repos.runs.list(task.id).some(isActiveRun)
  if (hasActiveRun) throw new ConflictError(`Task already has an active run: ${task.id}`)

  const spec = context.repos.specs.get(task.specId)
  if (spec == null) throw new NotFoundError(`Spec not found: ${task.specId}`)

  const runtime = resolveAgentRuntimeDetails(agent, spec.projectId, context.repos.configResources)
  const runtimeAgent = runtime.agent
  if (runtime.sandboxProfile != null) {
    assertSupportedSandboxProfileSpec(runtime.sandboxProfile, runtime.sandboxResource?.spec)
  }

  const parentRun = input.parentRunId == null
    ? null
    : context.repos.runs.get(input.parentRunId as Run['id'])
  const inheritedWorkflowProfile = parentRun?.runtimeWorkflowProfile == null
    ? null
    : requireMaterializedWorkflowProfile(parentRun.runtimeWorkflowProfile)
  let runtimeWorkflowProfile = inheritedWorkflowProfile ?? resolveAgentWorkflowProfile(runtimeAgent, spec.projectId, context.repos.configResources)
  if (runtimeWorkflowProfile != null && inheritedWorkflowProfile == null) {
    const ref = runtimeAgent.resourceRefs?.workflowProfileRef
    if (ref == null) {
      throw new AgentRuntimeResolutionError(
        `Agent ${runtimeAgent.name} resolved WorkflowProfile ${runtimeWorkflowProfile.name} without workflowProfileRef`,
        'runtime_config_missing',
      )
    }
    const workflowProfileName = runtimeWorkflowProfile.name
    if (context.validateWorkflowProfile == null) {
      throw new AgentRuntimeResolutionError(
        `Agent ${runtimeAgent.name} workflowProfileRef "${ref}" cannot be validated because API has no workflow profile validator`,
        'runtime_config_missing',
      )
    }
    try {
      runtimeWorkflowProfile = applyWorkflowProfileRuntimeData(
        runtimeWorkflowProfile,
        context.validateWorkflowProfile(runtimeWorkflowProfile),
      )
    } catch (error) {
      if (error instanceof AgentRuntimeResolutionError) throw error
      throw new AgentRuntimeResolutionError(
        `Agent ${runtimeAgent.name} workflowProfileRef "${ref}" could not render WorkflowProfile ${workflowProfileName}: ${toErrorMessage(error)}`,
        'resource_malformed',
      )
    }
  }

  const project = context.repos.projects.get(spec.projectId)
  if (project == null) throw new NotFoundError(`Project not found: ${spec.projectId}`)
  const scope = resolveTaskScope(task, {
    repositories: context.repos.repositories,
    components: context.repos.components,
    targets: context.repos.targets,
    specs: context.repos.specs,
  })

  if (task.assignedAgentId !== runtimeAgent.id) context.repos.tasks.assignAgent(task.id, runtimeAgent.id)
  if (task.status !== 'active') context.repos.tasks.updateStatus(task.id, 'active')

  const heartbeatTimeoutSeconds =
    input.heartbeatTimeoutSeconds ??
    context.repos.factory.get()?.config.heartbeatTimeoutSeconds ??
    120

  return context.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: runtimeAgent.id,
    parentRunId: (input.parentRunId ?? null) as Run['parentRunId'],
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: input.sessionId ?? null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    runtimeModel: runtimeAgent.model,
    runtimeHarness: runtimeAgent.harness,
    runtimeSandboxProfile: runtime.sandboxProfile,
    runtimeWorkflowProfile,
    attemptSnapshot: buildAttemptSnapshot({
      task,
      spec,
      project,
      agent,
      runtime,
      workflow: runtimeWorkflowProfile,
      repository: scope?.repository ?? null,
      component: scope?.component,
      capturedAt: context.now().toISOString(),
    }),
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: context.now().toISOString(),
    heartbeatTimeoutSeconds,
  })
}
