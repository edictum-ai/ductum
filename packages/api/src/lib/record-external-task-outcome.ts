import {
  createId,
  isExternalOutcome,
  type Agent,
  type Evidence,
  type EvidenceId,
  type ExternalOutcome,
  type Run,
  type RunId,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { ensureRecordedAuthorAgent } from './recorded-author-agent.js'

export interface RecordExternalTaskOutcomeInput {
  outcome: string
  reason: string
  author?: string | null
  runId?: string | null
  branch?: string | null
  commitSha?: string | null
  sourcePath?: string | null
  recordedAt?: string | null
}

export interface RecordExternalTaskOutcomeResult {
  task: Task
  run: Run
  agent: Agent
  evidence: Evidence
  alreadyRecorded: boolean
}

export function recordExternalTaskOutcome(
  context: ApiContext,
  taskId: Task['id'],
  input: RecordExternalTaskOutcomeInput,
): RecordExternalTaskOutcomeResult {
  const task = context.repos.tasks.get(taskId)
  if (task == null) throw new NotFoundError(`Task not found: ${taskId}`)
  const outcome = normalizeOutcome(input.outcome)
  const reason = normalizeRequired(input.reason, 'reason')
  const author = normalizeOptional(input.author) ?? 'operator'
  const recordedAt = normalizeRecordedAt(input.recordedAt, context)
  const runs = context.repos.runs.list(task.id)
  const latestRun = runs.at(-1) ?? null
  if (latestRun != null && latestRun.terminalState == null && latestRun.stage !== 'done') {
    throw new ConflictError(`Task ${task.id} has an active run: ${latestRun.id}`)
  }

  return context.db.transaction(() => {
    const agent = ensureRecordedAuthorAgent(context, author)
    const run = selectAnchorRun(task.id, runs, input.runId)
      ?? (latestRun?.stage === 'done' && latestRun.terminalState == null
        ? latestRun
        : null)
      ?? createRecordedDoneRun(context, task, agent, input, recordedAt)
    const existing = findMatchingOutcome(context, run.id, outcome, reason)
    const evidence = existing ?? context.repos.evidence.create({
      id: createId<'EvidenceId'>() as EvidenceId,
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'external-outcome',
        outcome,
        reason,
        author,
        recordedAt,
        ...(normalizeOptional(input.sourcePath) == null ? {} : { sourcePath: normalizeOptional(input.sourcePath) }),
      },
    })
    const updatedTask = task.status === 'done' ? task : context.repos.tasks.updateStatus(task.id, 'done')
    return { task: updatedTask, run, agent, evidence, alreadyRecorded: existing != null }
  })()
}

function selectAnchorRun(taskId: Task['id'], runs: readonly Run[], requestedRunId: string | null | undefined): Run | null {
  const explicitRunId = normalizeOptional(requestedRunId)
  if (explicitRunId != null) {
    const explicit = runs.find((candidate) => candidate.id === explicitRunId) ?? null
    if (explicit == null) throw new NotFoundError(`Run not found for task ${taskId}: ${explicitRunId}`)
    if (explicit.stage !== 'done') {
      throw new ConflictError(`External outcome anchor requires run ${explicit.id} to already be done`)
    }
    return explicit
  }

  const successfulRuns = runs.filter((candidate) => candidate.stage === 'done' && candidate.terminalState == null)
  if (successfulRuns.length <= 1) return successfulRuns[0] ?? null
  throw new ConflictError(
    `Task ${taskId} has multiple successful terminal runs; pass runId to choose the external outcome anchor`,
  )
}

function createRecordedDoneRun(
  context: ApiContext,
  task: Task,
  agent: Agent,
  input: RecordExternalTaskOutcomeInput,
  recordedAt: string,
): Run {
  return context.repos.runs.create({
    id: createId<'RunId'>() as RunId,
    taskId: task.id,
    agentId: agent.id,
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: normalizeOptional(input.branch),
    commitSha: normalizeOptional(input.commitSha),
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: recordedAt,
    heartbeatTimeoutSeconds: context.repos.factory.get()?.config.heartbeatTimeoutSeconds ?? 120,
  })
}

function findMatchingOutcome(context: ApiContext, runId: Run['id'], outcome: ExternalOutcome, reason: string) {
  return context.repos.evidence.list(runId).find((item) =>
    item.type === 'custom' &&
    item.payload.kind === 'external-outcome' &&
    item.payload.outcome === outcome &&
    item.payload.reason === reason,
  ) ?? null
}

function normalizeOutcome(value: string): ExternalOutcome {
  const outcome = normalizeRequired(value, 'outcome')
  if (!isExternalOutcome(outcome)) throw new ValidationError('outcome must be one of: done, fixed, superseded')
  return outcome
}

function normalizeRecordedAt(value: string | null | undefined, context: ApiContext) {
  const normalized = normalizeOptional(value)
  if (normalized == null) return context.now().toISOString()
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) throw new ValidationError('recordedAt must be an ISO timestamp')
  return date.toISOString()
}

function normalizeRequired(value: string | null | undefined, field: string) {
  const normalized = normalizeOptional(value)
  if (normalized == null) throw new ValidationError(`${field} is required`)
  return normalized
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? null : normalized
}
