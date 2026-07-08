import { createHash } from 'node:crypto'

import { blockTaskForPrerequisites } from './dispatcher-prerequisite-block.js'
import { PrerequisiteCheckError } from './repair-dispatch.js'
import { createId, type RunId, type Task } from './types.js'
import type { EvidenceRepo } from './repos/interfaces.js'
import type { TaskDispatchSkipRepo } from './repos/task-dispatch-skip.js'
import type { TaskRepo } from './repos/interfaces.js'
import type { FencingToken } from './attempt-lease.js'
import { runWorkspacePreflight } from './workspace-preflight.js'
import type {
  DispatcherWorkspacePreflightOverride,
  WorkspacePreflightConfig,
  WorkspacePreflightProbes,
  WorkspacePreflightResult,
} from './workspace-preflight-types.js'

/**
 * Issue #281: dispatcher hook that runs the configured workspace
 * hydration preflight before the implementation prompt reaches the
 * harness. Failure is fatal to the dispatch: the task is marked
 * blocked, a prerequisite dispatch-skip is recorded so the operator
 * sees the exact repair text in Needs Attention, and a
 * {@link PrerequisiteCheckError} is thrown so the dispatcher cycle
 * preserves the skip and no builder time is spent.
 *
 * Filesystem checks use the resolved agent working directory, which is
 * the per-run worktree when worktree isolation is enabled.
 *
 * On success, callers should call {@link recordPreflightEvidence}
 * after the Run record exists so the success payload is attached to
 * the attempt.
 */
export interface WorkspacePreflightDispatchInput {
  task: Task
  workingDir: string | undefined
  scope?: 'setup' | 'full'
  sandboxMode: 'host' | 'container' | undefined
  hasSandboxProfile: boolean
  hasInheritedWorktree: boolean
  config: WorkspacePreflightConfig | undefined
  hostEnv?: NodeJS.ProcessEnv
  probes?: WorkspacePreflightProbes
  now: Date
}

export interface WorkspacePreflightDispatchDeps {
  taskRepo: TaskRepo
  taskDispatchSkipRepo: TaskDispatchSkipRepo | undefined
}

export interface WorkspacePreflightEvidenceDeps {
  evidenceRepo?: EvidenceRepo
  /** Optional fence token so the evidence write participates in the dispatch lease. */
  fenceToken?: FencingToken
}

export class WorkspacePreflightFailedError extends PrerequisiteCheckError {
  constructor(readonly result: WorkspacePreflightResult) {
    super(result.ok === false ? result.issues : [])
    this.name = 'WorkspacePreflightFailedError'
  }
}

export function assertWorkspacePreflightForDispatch(
  deps: WorkspacePreflightDispatchDeps,
  input: WorkspacePreflightDispatchInput,
): WorkspacePreflightResult {
  if (input.config == null || input.config.enabled === false) {
    return { ok: true, checks: [{ id: 'preflight.disabled', label: 'Preflight disabled', status: 'skipped', detail: null }] }
  }
  const result = runWorkspacePreflight({
    config: input.config,
    workingDir: input.workingDir,
    scope: input.scope,
    sandboxMode: input.sandboxMode,
    hasSandboxProfile: input.hasSandboxProfile,
    hasInheritedWorktree: input.hasInheritedWorktree,
    hostEnv: input.hostEnv,
    probes: input.probes,
    task: input.task,
    now: input.now,
  })
  if (result.ok) return result
  const error = new WorkspacePreflightFailedError(result)
  blockTaskForPrerequisites(deps.taskRepo, deps.taskDispatchSkipRepo, {
    taskId: input.task.id,
    detail: error.message,
    blockedAt: input.now.toISOString(),
  })
  throw error
}

/**
 * Issue #281: dispatcher-side bridge that honors the optional config
 * override (`DispatcherConfig.runWorkspacePreflight`) for tests, then
 * falls back to {@link assertWorkspacePreflightForDispatch} with the
 * host probes. Extracted as a free function so the dispatcher-runtime
 * helper stays small.
 */
export function runDispatcherPreflight(
  deps: WorkspacePreflightDispatchDeps,
  input: {
    override: DispatcherWorkspacePreflightOverride | undefined
    probes: WorkspacePreflightProbes | undefined
    task: Task
    workingDir: string | undefined
    scope?: 'setup' | 'full'
    sandboxMode: 'host' | 'container' | undefined
    hasSandboxProfile: boolean
    hasInheritedWorktree: boolean
    config: WorkspacePreflightConfig | undefined
    hostEnv: NodeJS.ProcessEnv
    now: Date
  },
): WorkspacePreflightResult {
  if (input.override != null) {
    const result = input.override({
      task: input.task,
      workingDir: input.workingDir,
      scope: input.scope,
      sandboxMode: input.sandboxMode,
      hasSandboxProfile: input.hasSandboxProfile,
      hasInheritedWorktree: input.hasInheritedWorktree,
      config: input.config,
      now: input.now,
    })
    if (result.ok) return result
    const error = new WorkspacePreflightFailedError(result)
    blockTaskForPrerequisites(deps.taskRepo, deps.taskDispatchSkipRepo, {
      taskId: input.task.id,
      detail: error.message,
      blockedAt: input.now.toISOString(),
    })
    throw error
  }
  return assertWorkspacePreflightForDispatch(deps, {
    task: input.task,
    workingDir: input.workingDir,
    scope: input.scope,
    sandboxMode: input.sandboxMode,
    hasSandboxProfile: input.hasSandboxProfile,
    hasInheritedWorktree: input.hasInheritedWorktree,
    config: input.config,
    hostEnv: input.hostEnv,
    probes: input.probes,
    now: input.now,
  })
}

/**
 * Record the `preflight.hydration` evidence payload after the Run
 * record exists. The payload only contains check outcomes (id, label,
 * status, detail) — never secret values, env values, or command output
 * text. Probes already redact through {@link redactPublicText} before
 * the detail reaches the result, and the runner drops the `fail`
 * outcomes from the success evidence entirely.
 */
export function recordPreflightEvidence(
  deps: WorkspacePreflightEvidenceDeps,
  runId: RunId,
  result: WorkspacePreflightResult,
  now: Date,
  config: WorkspacePreflightConfig | undefined,
): void {
  if (deps.evidenceRepo == null) return
  if (!result.ok) return
  if (isDisabledPreflightResult(result)) return
  const payload = {
    kind: 'preflight.hydration',
    schemaVersion: 1,
    checks: result.checks
      .filter((check) => check.status !== 'fail')
      .map((check) => ({ id: check.id, label: check.label, status: check.status as 'pass' | 'skipped', detail: check.detail })),
    configFingerprint: computeConfigFingerprint(config),
    timestamp: now.toISOString(),
  }
  if (deps.fenceToken != null && deps.evidenceRepo.createFenced != null) {
    deps.evidenceRepo.createFenced({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: payload as unknown as Record<string, unknown>,
    }, deps.fenceToken)
    return
  }
  deps.evidenceRepo.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: payload as unknown as Record<string, unknown>,
  })
}

function computeConfigFingerprint(config: WorkspacePreflightConfig | undefined): string {
  return createHash('sha256').update(stableStringify(config ?? {})).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value != null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isDisabledPreflightResult(result: WorkspacePreflightResult): boolean {
  return result.ok && result.checks.length === 1 && result.checks[0]?.id === 'preflight.disabled'
}
