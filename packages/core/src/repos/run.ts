import type {
  Run,
  RunId,
  RunLatchStatus,
  RunStageTransition,
  TaskId,
  TerminalState,
  WorkflowStage,
} from '../types.js'
import type { FencingToken } from '../attempt-lease.js'
import type { RunRepo, RunStageHistoryRepo } from './interfaces.js'
import type { AttemptLeaseRepo } from './interfaces.js'
import { redactPublicText } from '../public-redaction.js'
import {
  assertChanges,
  assertFound,
  fromBoolean,
  parseJson,
  toBoolean,
  toIsoString,
  toJson,
  toRunLatchStatus,
  type SqliteDatabase,
} from './utils.js'

interface RunRow {
  id: RunId
  task_id: string
  agent_id: string
  parent_run_id: string | null
  stage: WorkflowStage
  terminal_state: string | null
  reset_count: number
  completed_stages: string | null
  blocked_reason: string | null
  pending_approval: number
  session_id: string | null
  branch: string | null
  commit_sha: string | null
  pr_number: number | null
  pr_url: string | null
  worktree_paths: string | null
  runtime_model: string | null
  runtime_harness: string | null
  runtime_sandbox_profile: string | null
  runtime_workflow_profile: string | null
  attempt_snapshot: string | null
  ci_status: string | null
  review_status: string | null
  fail_reason: string | null
  recoverable: number
  tokens_in: number
  tokens_out: number
  cost_usd: number
  last_heartbeat: string | null
  heartbeat_timeout_seconds: number
  verify_retries: number
  completion_summary: string | null
  created_at: string
  updated_at: string
}

interface TransitionRow {
  id: number
  run_id: string
  from_stage: string
  to_stage: string
  reason: string | null
  created_at: string
}

function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.task_id as TaskId,
    agentId: row.agent_id as Run['agentId'],
    parentRunId: row.parent_run_id as RunId | null,
    stage: row.stage,
    terminalState: (row.terminal_state as TerminalState) ?? null,
    resetCount: row.reset_count,
    completedStages: row.completed_stages != null ? parseJson<string[]>(row.completed_stages) : [],
    blockedReason: row.blocked_reason,
    pendingApproval: toBoolean(row.pending_approval),
    sessionId: row.session_id,
    branch: row.branch,
    commitSha: row.commit_sha,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    worktreePaths: row.worktree_paths != null ? parseJson<string[]>(row.worktree_paths) : null,
    runtimeModel: row.runtime_model,
    runtimeHarness: row.runtime_harness,
    runtimeSandboxProfile: row.runtime_sandbox_profile != null
      ? parseJson<NonNullable<Run['runtimeSandboxProfile']>>(row.runtime_sandbox_profile)
      : null,
    runtimeWorkflowProfile: row.runtime_workflow_profile != null
      ? parseJson<NonNullable<Run['runtimeWorkflowProfile']>>(row.runtime_workflow_profile)
      : null,
    attemptSnapshot: row.attempt_snapshot != null
      ? parseJson<NonNullable<Run['attemptSnapshot']>>(row.attempt_snapshot)
      : null,
    ciStatus: toRunLatchStatus(row.ci_status),
    reviewStatus: toRunLatchStatus(row.review_status),
    failReason: row.fail_reason,
    recoverable: toBoolean(row.recoverable),
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd,
    lastHeartbeat: toIsoString(row.last_heartbeat),
    heartbeatTimeoutSeconds: row.heartbeat_timeout_seconds,
    verifyRetries: row.verify_retries ?? 0,
    completionSummary: row.completion_summary,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

function mapTransition(row: TransitionRow): RunStageTransition {
  return {
    id: row.id,
    runId: row.run_id as RunId,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    reason: row.reason,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

export class SqliteRunRepo implements RunRepo {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly attemptLeaseRepo?: AttemptLeaseRepo,
  ) {}

  list(taskId: TaskId): Run[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at, rowid')
      .all(taskId)
      .map((row) => mapRun(row as RunRow))
  }

  listByTaskIds(taskIds: readonly TaskId[]): Run[] {
    if (taskIds.length === 0) return []
    const placeholders = taskIds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM runs WHERE task_id IN (${placeholders}) ORDER BY created_at, rowid`)
      .all(...taskIds)
      .map((row) => mapRun(row as RunRow))
  }

  listAll(filters?: { stage?: string; limit?: number }): Run[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.stage) {
      conditions.push('stage = ?')
      params.push(filters.stage)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters?.limit ?? 50
    params.push(limit)

    return this.db
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params)
      .map((row) => mapRun(row as RunRow))
  }

  get(id: RunId): Run | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
    return row == null ? null : mapRun(row)
  }

  getBySessionId(sessionId: string): Run | null {
    const row = this.db
      .prepare(
        `
          SELECT r.*
          FROM session_run_mapping s
          JOIN runs r ON r.id = s.run_id
          WHERE s.session_id = ?
        `,
      )
      .get(sessionId) as RunRow | undefined
    return row == null ? null : mapRun(row)
  }

  getActive(): Run[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE stage != 'done' AND terminal_state IS NULL ORDER BY created_at")
      .all()
      .map((row) => mapRun(row as RunRow))
  }

  /**
   * Decisions 114 & 118: runs paused or denied on a runtime resource
   * (cost budget OR agent-turn cap) have their worktrees pinned on
   * disk so the operator can salvage partial work. Returns rows
   * whose failReason carries any of those gate prefixes.
   */
  listFailedWithBudgetReason(): Run[] {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE fail_reason LIKE 'cost_budget_%' OR fail_reason LIKE 'spec_cost_budget_%' OR fail_reason LIKE 'max_turns_%' ORDER BY created_at DESC",
      )
      .all()
      .map((row) => mapRun(row as RunRow))
  }

  getStalled(cutoffTime: string): Run[] {
    const normalizedCutoff = cutoffTime.replace('T', ' ').replace('Z', '')
    return this.db
      .prepare(
        `
          SELECT * FROM runs
          WHERE stage NOT IN ('done', 'failed', 'stalled')
            AND COALESCE(last_heartbeat, created_at) < ?
          ORDER BY created_at
        `,
      )
      .all(normalizedCutoff)
      .map((row) => mapRun(row as RunRow))
  }

  create(
    run: Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'attemptSnapshot' | 'verifyRetries'>
      & Partial<Pick<Run, 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'attemptSnapshot' | 'verifyRetries'>>,
  ): Run {
    const insert = this.db.transaction(() => {
      if (run.parentRunId == null) {
        const existing = this.db
          .prepare(
            "SELECT id FROM runs WHERE task_id = ? AND parent_run_id IS NULL AND stage != 'done' AND terminal_state IS NULL LIMIT 1",
          )
          .get(run.taskId) as Pick<RunRow, 'id'> | undefined
        if (existing != null) {
          throw new Error(`Task ${run.taskId} already has an active run: ${existing.id}`)
        }
      }
      this.db
        .prepare(
          `INSERT INTO runs (
            id, task_id, agent_id, parent_run_id, stage, terminal_state,
            reset_count, completed_stages, blocked_reason, pending_approval,
            session_id, branch, commit_sha, pr_number, pr_url,
            worktree_paths, runtime_model, runtime_harness,
            runtime_sandbox_profile, runtime_workflow_profile, attempt_snapshot,
            ci_status, review_status, fail_reason, recoverable,
            tokens_in, tokens_out, cost_usd, last_heartbeat, heartbeat_timeout_seconds,
            verify_retries, completion_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.taskId,
          run.agentId,
          run.parentRunId,
          run.stage,
          run.terminalState,
          run.resetCount,
          run.completedStages.length > 0 ? toJson(run.completedStages) : null,
          run.blockedReason,
          fromBoolean(run.pendingApproval),
          run.sessionId,
          run.branch,
          run.commitSha,
          run.prNumber,
          run.prUrl,
          run.worktreePaths != null ? toJson(run.worktreePaths) : null,
          run.runtimeModel ?? null,
          run.runtimeHarness ?? null,
          run.runtimeSandboxProfile != null ? toJson(run.runtimeSandboxProfile) : null,
          run.runtimeWorkflowProfile != null ? toJson(run.runtimeWorkflowProfile) : null,
          run.attemptSnapshot != null ? toJson(run.attemptSnapshot) : null,
          run.ciStatus,
          run.reviewStatus,
          run.failReason,
          fromBoolean(run.recoverable),
          run.tokensIn,
          run.tokensOut,
          run.costUsd,
          run.lastHeartbeat?.replace('T', ' ').replace('Z', '') ?? null,
          run.heartbeatTimeoutSeconds,
          run.verifyRetries ?? 0,
          null, // completion_summary — always null at creation time
        )
    })
    insert()
    return this.getRequired(run.id)
  }

  updateSession(id: RunId, sessionId: string | null): Run {
    const result = this.db
      .prepare("UPDATE runs SET session_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(sessionId, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateWorktreePaths(id: RunId, paths: string[] | null): Run {
    const result = this.db
      .prepare("UPDATE runs SET worktree_paths = ?, updated_at = datetime('now') WHERE id = ?")
      .run(paths == null ? null : toJson(paths), id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateStage(id: RunId, stage: WorkflowStage, reason?: string): Run {
    const result = this.db
      .prepare("UPDATE runs SET stage = ?, fail_reason = ?, updated_at = datetime('now') WHERE id = ?")
      .run(stage, reason == null ? null : redactPublicText(reason), id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateTerminalState(id: RunId, terminalState: TerminalState | null): Run {
    const result = this.db
      .prepare("UPDATE runs SET terminal_state = ?, updated_at = datetime('now') WHERE id = ?")
      .run(terminalState, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateTerminalStateFenced(id: RunId, terminalState: TerminalState | null, fenceToken: FencingToken, now?: Date): Run {
    this.assertFence(id, fenceToken, now)
    return this.updateTerminalState(id, terminalState)
  }

  updateAttemptSnapshot(id: RunId, snapshot: NonNullable<Run['attemptSnapshot']>): Run {
    const result = this.db
      .prepare("UPDATE runs SET attempt_snapshot = ?, updated_at = datetime('now') WHERE id = ?")
      .run(toJson(snapshot), id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateWorkflowState(
    id: RunId,
    fields: {
      completedStages?: string[]
      blockedReason?: string | null
      pendingApproval?: boolean
    },
  ): Run {
    const updates: string[] = []
    const values: unknown[] = []

    if (fields.completedStages !== undefined) {
      updates.push('completed_stages = ?')
      values.push(fields.completedStages.length > 0 ? toJson(fields.completedStages) : null)
    }
    if (fields.blockedReason !== undefined) {
      updates.push('blocked_reason = ?')
      values.push(fields.blockedReason == null ? null : redactPublicText(fields.blockedReason))
    }
    if (fields.pendingApproval !== undefined) {
      updates.push('pending_approval = ?')
      values.push(fromBoolean(fields.pendingApproval))
    }
    if (updates.length === 0) return this.getRequired(id)

    updates.push("updated_at = datetime('now')")
    const result = this.db.prepare(`UPDATE runs SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  incrementResetCount(id: RunId): Run {
    const result = this.db
      .prepare("UPDATE runs SET reset_count = reset_count + 1, updated_at = datetime('now') WHERE id = ?")
      .run(id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateGitArtifacts(
    id: RunId,
    fields: Partial<Pick<Run, 'branch' | 'commitSha' | 'prNumber' | 'prUrl'>>,
  ): Run {
    const updates: string[] = []
    const values: unknown[] = []

    if (fields.branch !== undefined) {
      updates.push('branch = ?')
      values.push(fields.branch)
    }
    if (fields.commitSha !== undefined) {
      updates.push('commit_sha = ?')
      values.push(fields.commitSha)
    }
    if (fields.prNumber !== undefined) {
      updates.push('pr_number = ?')
      values.push(fields.prNumber)
    }
    if (fields.prUrl !== undefined) {
      updates.push('pr_url = ?')
      values.push(fields.prUrl)
    }
    if (updates.length === 0) {
      return this.getRequired(id)
    }

    updates.push("updated_at = datetime('now')")
    const result = this.db.prepare(`UPDATE runs SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateLatchStatus(id: RunId, field: 'ciStatus' | 'reviewStatus', status: RunLatchStatus): Run {
    const column = field === 'ciStatus' ? 'ci_status' : 'review_status'
    const result = this.db
      .prepare(`UPDATE runs SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateHeartbeat(id: RunId): Run {
    const result = this.db
      .prepare("UPDATE runs SET last_heartbeat = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  incrementVerifyRetries(id: RunId): Run {
    const result = this.db
      .prepare("UPDATE runs SET verify_retries = verify_retries + 1, updated_at = datetime('now') WHERE id = ?")
      .run(id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateTokens(id: RunId, tokensIn: number, tokensOut: number, costUsd: number): Run {
    const result = this.db
      .prepare(
        `
          UPDATE runs
          SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ?,
              updated_at = datetime('now')
          WHERE id = ?
        `,
      )
      .run(tokensIn, tokensOut, costUsd, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateTokensFenced(id: RunId, tokensIn: number, tokensOut: number, costUsd: number, fenceToken: FencingToken, now?: Date): Run {
    this.assertFence(id, fenceToken, now)
    return this.updateTokens(id, tokensIn, tokensOut, costUsd)
  }

  setTokens(id: RunId, tokensIn: number, tokensOut: number, costUsd: number): Run {
    const result = this.db
      .prepare(
        `
          UPDATE runs
          SET tokens_in = ?, tokens_out = ?, cost_usd = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `,
      )
      .run(tokensIn, tokensOut, costUsd, id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  setTokensFenced(id: RunId, tokensIn: number, tokensOut: number, costUsd: number, fenceToken: FencingToken, now?: Date): Run {
    this.assertFence(id, fenceToken, now)
    return this.setTokens(id, tokensIn, tokensOut, costUsd)
  }

  updateFailure(id: RunId, reason: string | null, recoverable: boolean): Run {
    const result = this.db
      .prepare(
        "UPDATE runs SET fail_reason = ?, recoverable = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(reason == null ? null : redactPublicText(reason), fromBoolean(recoverable), id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  updateCompletionSummary(id: RunId, summary: string | null): Run {
    const result = this.db
      .prepare("UPDATE runs SET completion_summary = ?, updated_at = datetime('now') WHERE id = ?")
      .run(summary == null ? null : redactPublicText(summary), id)
    assertChanges(result.changes, `Run not found: ${id}`)
    return this.getRequired(id)
  }

  private getRequired(id: RunId): Run {
    return assertFound(this.get(id), `Run not found: ${id}`)
  }

  private assertFence(id: RunId, fenceToken: FencingToken, now?: Date): void {
    if (this.attemptLeaseRepo == null) throw new Error('Attempt lease repo is required for fenced run writes')
    this.attemptLeaseRepo.assertCanWrite(id, fenceToken, now)
  }
}

export class SqliteRunStageHistoryRepo implements RunStageHistoryRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(runId: RunId): RunStageTransition[] {
    return this.db
      .prepare('SELECT * FROM run_stage_history WHERE run_id = ? ORDER BY id')
      .all(runId)
      .map((row) => mapTransition(row as TransitionRow))
  }

  add(transition: Omit<RunStageTransition, 'id' | 'createdAt'>): RunStageTransition {
    const result = this.db
      .prepare('INSERT INTO run_stage_history (run_id, from_stage, to_stage, reason) VALUES (?, ?, ?, ?)')
      .run(
        transition.runId,
        transition.fromStage,
        transition.toStage,
        transition.reason == null ? null : redactPublicText(transition.reason),
      )
    const row = this.db
      .prepare('SELECT * FROM run_stage_history WHERE id = ?')
      .get(result.lastInsertRowid) as TransitionRow | undefined
    return mapTransition(assertFound(row, 'Run stage transition was not created'))
  }
}
