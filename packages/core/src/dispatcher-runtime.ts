import { isAbsolute } from 'node:path'

import {
  agentSystemPromptEvidence,
  type AgentSystemPromptRuntime,
} from './agent-prompt-runtime.js'
import {
  AgentRuntimeResolutionError,
  resolveAgentRuntimeDetails,
  type AgentRuntimeResolution,
} from './agent-runtime-resolution.js'
import { toErrorMessage } from './dispatcher-support.js'
import { log } from './logger.js'
import {
  applyWorkflowProfileRuntimeData,
  requireMaterializedWorkflowProfile,
  resolveAgentWorkflowProfile,
} from './workflow-profile-runtime.js'
import { DispatcherBase } from './dispatcher-base.js'
import type { DispatchOptions } from './dispatcher-types.js'
import type { PreparedSandboxRuntime } from './sandbox-runtime.js'
import type { ResolvedTaskScope } from './task-scope.js'
import { createId, type Agent, type Run, type RunId, type RunWorkflowProfileSnapshot, type Task } from './types.js'

export abstract class DispatcherRuntime extends DispatcherBase {
  protected resolveRuntimeAgent(task: Task, agent: Agent): AgentRuntimeResolution<Agent> {
    const refs = agent.resourceRefs ?? {}
    if (refs.modelRef == null && refs.harnessRef == null && refs.sandboxRef == null) {
      return { agent, modelResource: null, harnessResource: null, harnessSnapshot: null, sandboxResource: null, sandboxProfile: null }
    }
    if (this.configResourceRepo == null) {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} has runtime refs but dispatcher has no config resource repo`, 'runtime_config_missing')
    }
    const spec = this.specRepo.get(task.specId)
    if (spec == null) throw new AgentRuntimeResolutionError(`Spec not found: ${task.specId}`, 'runtime_spec_missing')
    return resolveAgentRuntimeDetails(agent, spec.projectId, this.configResourceRepo)
  }

  protected resolveRuntimeWorkflowProfile(task: Task, agent: Agent): RunWorkflowProfileSnapshot | null {
    if (agent.resourceRefs?.workflowProfileRef == null) return null
    if (this.configResourceRepo == null) {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} has workflowProfileRef but dispatcher has no config resource repo`, 'runtime_config_missing')
    }
    const spec = this.specRepo.get(task.specId)
    if (spec == null) throw new AgentRuntimeResolutionError(`Spec not found: ${task.specId}`, 'runtime_spec_missing')
    return resolveAgentWorkflowProfile(agent, spec.projectId, this.configResourceRepo)
  }

  protected resolveInheritedWorkflowProfile(options: DispatchOptions): RunWorkflowProfileSnapshot | null {
    if (options.parentRunId == null) return null
    const parent = this.runRepo.get(options.parentRunId)
    if (parent?.runtimeWorkflowProfile == null) return null
    return requireMaterializedWorkflowProfile(parent.runtimeWorkflowProfile)
  }

  protected resolveSetupCommands(
    projectName: string,
    workflowProfile: RunWorkflowProfileSnapshot | null,
  ): string[] | undefined {
    try {
      return this.resolvedConfig.resolveSetupCommands?.(projectName, workflowProfile ?? undefined)
    } catch (error) {
      if (error instanceof AgentRuntimeResolutionError) throw error
      if (workflowProfile != null) {
        throw new AgentRuntimeResolutionError(
          `WorkflowProfile ${workflowProfile.name} (${workflowProfile.path}) could not resolve setup commands: ${toErrorMessage(error)}`,
          'resource_malformed',
        )
      }
      throw error
    }
  }

  protected resolveRuntimeAgentForRun(run: Run): Agent | null {
    const snapshot = this.resolvedRunAgents.get(run.id)
    if (snapshot != null) return snapshot
    const agent = this.agentRepo.get(run.agentId)
    if (agent == null) return null
    if (run.runtimeModel != null && run.runtimeHarness != null) {
      return {
        ...agent,
        model: run.runtimeModel,
        harness: run.runtimeHarness as Agent['harness'],
      }
    }
    if (run.runtimeModel != null || run.runtimeHarness != null) {
      log.warn('dispatcher', `run ${run.id} has a partial runtime agent snapshot; no cost model will be inferred`)
      return null
    }
    if (agent.resourceRefs?.modelRef != null || agent.resourceRefs?.harnessRef != null) {
      log.warn('dispatcher', `run ${run.id} has runtime refs but no runtime agent snapshot; no cost model will be inferred`)
      return null
    }
    return agent
  }

  protected recordHarnessRuntimeEvidence(runId: RunId, runtime: AgentRuntimeResolution<Agent>): void {
    if (this.evidenceRepo == null || runtime.harnessSnapshot == null) return
    this.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: {
        kind: 'runtime.harness.resolved',
        harness: runtime.harnessSnapshot,
      },
    })
  }

  protected recordWorkflowRuntimeEvidence(runId: RunId, workflowProfile: RunWorkflowProfileSnapshot | null): void {
    if (this.evidenceRepo == null || workflowProfile == null) return
    this.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: {
        kind: 'runtime.workflow_profile.resolved',
        workflowProfile,
      },
    })
  }

  protected recordSandboxRuntimeEvidence(runId: RunId, sandbox: PreparedSandboxRuntime): void {
    if (this.evidenceRepo == null) return
    this.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: {
        kind: 'runtime.sandbox.prepared',
        sandbox,
      },
    })
  }

  protected recordAgentSystemPromptEvidence(runId: RunId, prompt: AgentSystemPromptRuntime): void {
    if (this.evidenceRepo == null) return
    this.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: {
        kind: 'runtime.agent_system_prompt.resolved',
        systemPrompt: agentSystemPromptEvidence(prompt),
      },
    })
  }

  protected resolveWorkingDir(task: Task, scope?: ResolvedTaskScope | null): string | undefined {
    const scopedWorkingDir = this.resolveScopeWorkingDir(scope)
    if (scopedWorkingDir != null) return scopedWorkingDir

    const taskRepo = task.repos[0]
    if (taskRepo != null) {
      const resolved = this.resolvedConfig.resolveRepoPath?.(taskRepo)
      if (resolved != null) return resolved
      if (isAbsolute(taskRepo)) return taskRepo
    }
    if (this.resolvedConfig.resolveRepoPath == null) return undefined
    const spec = this.specRepo.get(task.specId)
    if (spec != null) {
      const project = this.projectRepo.get(spec.projectId)
      const projectRepo = project?.repos[0]
      if (projectRepo != null) {
        const resolved = this.resolvedConfig.resolveRepoPath(projectRepo)
        if (resolved != null) return resolved
      }
    }
    return undefined
  }

  private resolveScopeWorkingDir(scope?: ResolvedTaskScope | null): string | undefined {
    const repository = scope?.repository
    if (repository == null) return undefined

    const candidates = [
      repository.spec.localPath,
      repository.identity.kind === 'local' ? repository.identity.value : undefined,
      repository.name,
      repository.spec.remoteUrl,
    ]
    for (const candidate of candidates) {
      const value = candidate?.trim()
      if (value == null || value === '') continue
      const resolved = this.resolvedConfig.resolveRepoPath?.(value)
      if (resolved != null) return resolved
      if (isAbsolute(value)) return value
    }
    return undefined
  }

  protected resolveProjectName(task: Task): string | undefined {
    const spec = this.specRepo.get(task.specId)
    if (spec == null) return undefined
    const project = this.projectRepo.get(spec.projectId)
    return project?.name
  }

  protected resolveScannerSnapshot(runId: RunId) {
    const mapping = this.sessionMappingRepo.getByRunId(runId)
    if (mapping == null || mapping.harnessSessionId == null || mapping.harnessSessionId === '') return null
    if (mapping.harness === 'codex-sdk' || mapping.harness === 'codex-app-server') {
      return this.costScanner.getCodexSession(mapping.harnessSessionId)
    }
    if (mapping.harness === 'claude-agent-sdk') {
      return this.costScanner.getClaudeSession(mapping.harnessSessionId)
    }
    return null
  }

  protected materializeWorkflowProfile(
    task: Task,
    runtimeAgent: Agent,
    inheritedWorkflowProfile: RunWorkflowProfileSnapshot | null,
  ): RunWorkflowProfileSnapshot | null {
    let runtimeWorkflowProfile = inheritedWorkflowProfile ?? this.resolveRuntimeWorkflowProfile(task, runtimeAgent)
    if (runtimeWorkflowProfile == null || inheritedWorkflowProfile != null) return runtimeWorkflowProfile
    const workflowProfileRef = runtimeAgent.resourceRefs?.workflowProfileRef
    if (workflowProfileRef == null) {
      throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} resolved WorkflowProfile ${runtimeWorkflowProfile.name} without workflowProfileRef`, 'runtime_config_missing')
    }
    const workflowProfileName = runtimeWorkflowProfile.name
    if (this.resolvedConfig.validateWorkflowProfile == null) {
      throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} workflowProfileRef "${workflowProfileRef}" cannot be validated because dispatcher has no workflow profile validator`, 'runtime_config_missing')
    }
    try {
      runtimeWorkflowProfile = applyWorkflowProfileRuntimeData(
        runtimeWorkflowProfile,
        this.resolvedConfig.validateWorkflowProfile(runtimeWorkflowProfile),
      )
    } catch (error) {
      if (error instanceof AgentRuntimeResolutionError) throw error
      throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} workflowProfileRef "${workflowProfileRef}" could not render WorkflowProfile ${workflowProfileName}: ${toErrorMessage(error)}`, 'resource_malformed')
    }
    return runtimeWorkflowProfile
  }
}
