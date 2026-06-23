import {
  createId,
  type Agent,
  type Evidence,
  type RunId,
  type EvidenceId,
  type Run,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { ensureRecordedAuthorAgent } from './recorded-author-agent.js'

export interface RecordedImportCommitRef {
  sha: string
  author: string
  subject: string
  branch?: string | null
  taskName?: string
  path?: string
}

export interface RecordImportedTaskRunInput {
  author: string
  branch?: string | null
  commitSha: string
  sourcePath: string
  taskFilePath?: string | null
  subject?: string | null
  importedAt?: string | null
  linkedCommits?: RecordedImportCommitRef[]
}

export interface RecordImportedTaskRunResult {
  task: Task
  run: Run
  agent: Agent
  evidence: Evidence
  alreadyRecorded: boolean
}

export function recordImportedTaskRun(
  context: ApiContext,
  taskId: Task['id'],
  input: RecordImportedTaskRunInput,
): RecordImportedTaskRunResult {
  const task = context.repos.tasks.get(taskId)
  if (task == null) throw new NotFoundError(`Task not found: ${taskId}`)
  if (blank(input.author)) throw new ValidationError('author is required')
  if (blank(input.commitSha)) throw new ValidationError('commitSha is required')
  if (blank(input.sourcePath)) throw new ValidationError('sourcePath is required')

  const runs = context.repos.runs.list(task.id)
  const imported = findImportedRun(context, runs)
  if (imported != null) {
    const updatedTask = task.status === 'done' ? task : context.repos.tasks.updateStatus(task.id, 'done')
    return {
      task: updatedTask,
      run: imported.run,
      evidence: imported.evidence,
      agent: requireAgent(context, imported.run.agentId),
      alreadyRecorded: true,
    }
  }

  const activeRun = runs.find((run) => run.terminalState == null && run.stage !== 'done')
  if (activeRun != null) {
    throw new ConflictError(`Task ${task.id} has an active run: ${activeRun.id}`)
  }
  if (runs.length > 0) {
    throw new ConflictError(`Task ${task.id} already has run history; refusing to append a bulk-import run`)
  }

  const importedAt = normalizeImportedAt(input.importedAt, context)
  const result = context.db.transaction(() => {
    const agent = ensureRecordedAuthorAgent(context, input.author)
    const run = context.repos.runs.create({
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
      branch: blank(input.branch) ? 'main' : input.branch!.trim(),
      commitSha: input.commitSha.trim(),
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
      lastHeartbeat: importedAt,
      heartbeatTimeoutSeconds: context.repos.factory.get()?.config.heartbeatTimeoutSeconds ?? 120,
    })
    const evidence = context.repos.evidence.create({
      id: createId<'EvidenceId'>() as EvidenceId,
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'bulk-import-shipped-spec',
        sourcePath: input.sourcePath.trim(),
        taskFilePath: blank(input.taskFilePath) ? null : input.taskFilePath!.trim(),
        importedAt,
        author: input.author.trim(),
        branch: blank(input.branch) ? 'main' : input.branch!.trim(),
        commitSha: input.commitSha.trim(),
        subject: blank(input.subject) ? null : input.subject!.trim(),
        linkedCommits: normalizeLinkedCommits(input.linkedCommits),
      },
    })
    const updatedTask = task.status === 'done' ? task : context.repos.tasks.updateStatus(task.id, 'done')
    return { task: updatedTask, run, evidence, agent }
  })()

  return { ...result, alreadyRecorded: false }
}

function findImportedRun(context: ApiContext, runs: readonly Run[]) {
  for (const run of runs) {
    const evidence = context.repos.evidence.list(run.id).find((item) =>
      item.type === 'custom' && item.payload.kind === 'bulk-import-shipped-spec',
    )
    if (evidence != null) return { run, evidence }
  }
  return null
}

function requireAgent(context: ApiContext, agentId: Run['agentId']) {
  const agent = context.repos.agents.get(agentId)
  if (agent == null) throw new NotFoundError(`Agent not found: ${agentId}`)
  return agent
}

function normalizeImportedAt(value: string | null | undefined, context: ApiContext) {
  if (blank(value)) return context.now().toISOString()
  const date = new Date(value!)
  if (Number.isNaN(date.getTime())) throw new ValidationError('importedAt must be an ISO timestamp')
  return date.toISOString()
}

function normalizeLinkedCommits(value: RecordedImportCommitRef[] | undefined) {
  return (value ?? []).map((item) => ({
    sha: item.sha.trim(),
    author: item.author.trim(),
    subject: item.subject.trim(),
    branch: blank(item.branch) ? 'main' : item.branch!.trim(),
    ...(blank(item.taskName) ? {} : { taskName: item.taskName!.trim() }),
    ...(blank(item.path) ? {} : { path: item.path!.trim() }),
  }))
}

function blank(value: string | null | undefined): value is null | undefined | '' {
  return value == null || value.trim() === ''
}
