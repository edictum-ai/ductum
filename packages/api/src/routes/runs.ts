import {
  createId,
  customPayloadHasSuccessSignal,
  DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD,
  isBakeoffCandidateOutcome,
  isExternalOutcome,
  log,
  PrerequisiteCheckError,
  validateEvidencePayload as validateTypedEvidencePayload,
  type Run,
} from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { envelope } from '../lib/envelope.js'
import { listEnrichedRuns } from '../lib/enriched-runs.js'
import { ConflictError, NotFoundError, ValidationError, toHttpError } from '../lib/errors.js'
import { structuredError } from '../lib/errors-structured.js'
import { kickDispatcherForReadyTask } from '../lib/dispatch-kick.js'
import { resolveRunFence } from '../lib/lease-fence.js'
import { requireUnattendedOperatorAuth } from '../middleware/operator-auth.js'
import {
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
  readJson,
  requireString,
} from '../lib/http.js'
import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { buildApiTaskPrerequisiteIssues } from '../lib/repair.js'
import { requireLatestTaskRun, requireRun } from '../lib/operator-run-guards.js'
import { buildOperatorRetryReviewPrompt } from '../lib/review-retry-prompt.js'
import { decorateNullableRunWithUi, decorateRunsWithUi, decorateRunWithUi } from '../lib/run-ui-context.js'
import { SESSION_CONTROL_TOKEN_HEADER } from '../lib/session-control.js'
import { parseGitHubPullRef, parseGitHubRepoRef } from '../lib/github-ref.js'
import {
  publicEvidence,
  publicNullableRun,
  publicOutput,
  publicRun,
  publicRunActivity,
  publicRunHistory,
  publicRuns,
  publicRunUpdate,
} from '../lib/public-output.js'
import { cancelRun } from '../lib/run-cancel.js'
import {
  acceptRun,
  addEvidence,
  approveRun,
  approveRunWithRebase,
  assertRunCanComplete,
  completeRun,
  denyBudget,
  denyTurns,
  extendBudget,
  extendTurns,
  failRun,
  gateCheck,
  getRunDiff,
  getTaskContext,
  linkRun,
  pauseRun,
  recordProgress,
  rejectRun,
  redirectRun,
  reportToolSuccess,
  resumePausedRun,
} from '../lib/run-ops.js'
import { registerRunControlRoutes } from './run-control.js'

const CUSTOM_EVIDENCE_KINDS = new Set([
  'bulk-import-shipped-spec',
  'external-outcome',
  'bakeoff-candidate-outcome',
  'best-of-n-verdict',
  'verify',
  'internal-review',
  'operator.cancel',
  'operator-note',
  'exit_demo.run',
])

function sanitizeRouteEvidencePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload }
  delete sanitized[DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD]
  if (payload.kind === 'internal-review') {
    delete sanitized.commitSha
    delete sanitized.commit
    delete sanitized.headCommitSha
    delete sanitized.headSha
  }
  return sanitized
}

function resolveLinkFields(body: Record<string, unknown>) {
  const branch = optionalString(body.branch, 'branch')
  const commitSha = optionalString(body.commitSha, 'commitSha') ?? optionalString(body.commit, 'commit')
  const prValue = body.pr
  const prNumber =
    typeof prValue === 'number'
      ? prValue
      : typeof prValue === 'string' && /^\d+$/.test(prValue)
        ? Number(prValue)
        : optionalNumber(body.prNumber, 'prNumber')
  const prUrl =
    optionalString(body.prUrl, 'prUrl') ??
    (typeof prValue === 'string' && /^https?:\/\//.test(prValue) ? prValue : undefined)

  return {
    branch,
    commitSha,
    prNumber: prUrl !== undefined && prNumber === undefined ? null : prNumber,
    prUrl: prNumber !== undefined && prUrl === undefined ? null : prUrl,
  }
}

function resolveLinkFieldsForRun(
  context: ApiContext,
  run: Run,
  body: Record<string, unknown>,
): Partial<Pick<Run, 'branch' | 'commitSha' | 'prNumber' | 'prUrl'>> {
  const fields = resolveLinkFields(body)
  if (fields.prUrl !== null || typeof fields.prNumber !== 'number') return fields
  if (!context.enforcement.isExternalReviewRequired(run.id)) return fields
  const prUrl = derivePullUrlForRun(context, run, fields.prNumber)
  if (prUrl == null) {
    throw new ValidationError('External-review numeric PR relinks require a repository remote or existing GitHub PR URL')
  }
  return { ...fields, prUrl }
}

function derivePullUrlForRun(context: ApiContext, run: Run, prNumber: number): string | null {
  const task = context.repos.tasks.get(run.taskId)
  const repository = task?.repositoryId == null ? null : context.repos.repositories.get(task.repositoryId as never)
  const repoRef = parseGitHubRepoRef(repository?.spec.remoteUrl ?? '')
    ?? (run.prUrl == null ? null : parseGitHubPullRef(run.prUrl))
  if (repoRef == null) return null
  return `https://${repoRef.host}/${repoRef.owner}/${repoRef.repo}/pull/${prNumber}`
}

async function requestRunSessionEnd(context: ApiContext, runId: string): Promise<void> {
  if (context.endSession == null) return
  await context.endSession(runId).catch((error) => {
    log.warn(
      'api',
      `session teardown request failed for ${runId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
}

export function registerRunRoutes(app: Hono, context: ApiContext) {
  app.get('/api/runs', (c) => {
    // Returns EnrichedRun[] — joined with task/spec/project/agent rows
    // so the dashboard can render row context (taskName, agentModel,
    // retryCount) without N+1 fetches. The base Run fields are still
    // present, so existing consumers that only read those keep working.
    const stage = c.req.query('stage')
    const limit = c.req.query('limit')
    return c.json(
      publicRuns(listEnrichedRuns(context, {
        stage: stage || undefined,
        limit: limit ? Number(limit) : undefined,
      })),
    )
  })

  app.get('/api/tasks/:taskId/runs', (c) => {
    const taskId = c.req.param('taskId')
    if (context.repos.tasks.get(taskId as never) == null) {
      throw new NotFoundError(`Task not found: ${taskId}`)
    }
    return c.json(publicRuns(decorateRunsWithUi(context, context.repos.runs.list(taskId as never))))
  })

  app.get('/api/runs/:id', (c) => {
    const run = context.repos.runs.get(c.req.param('id') as never)
    if (run == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    return c.json(publicRun(decorateRunWithUi(context, run)))
  })

  app.get('/api/runs/:id/history', (c) =>
    c.json(context.repos.runHistory.list(c.req.param('id') as never).map(publicRunHistory)),
  )

  // Diff viewer — returns the git diff between the run's worktree
  // branch and main. Powers the dashboard DiffViewer component.
  app.get('/api/runs/:id/diff', async (c) => {
    const base = c.req.query('base') ?? 'main'
    const result = await getRunDiff(context, c.req.param('id') as never, { base })
    return c.json(publicOutput(result))
  })

  app.post('/api/runs/:id/tool-success', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const fenceToken = resolveRunFence(context, runId, c.req.header(SESSION_CONTROL_TOKEN_HEADER))
    const tool = requireString(body.tool, 'tool')
    const args = (body.args ?? {}) as Record<string, unknown>
    await reportToolSuccess(context, runId, tool, args, fenceToken)
    return c.json(publicOutput({ ok: true }))
  })

  app.get('/api/runs/:id/workflow', async (c) => {
    const info = await context.enforcement.getWorkflowInfo(c.req.param('id') as never)
    return c.json(publicOutput(info))
  })

  app.post('/api/runs/next-task', async (c) => {
    const body = (await readJson<Record<string, unknown>>(c).catch(() => ({}))) as Record<string, unknown>
    const task = context.dag.nextTask(
      optionalString(body.projectId, 'projectId') as never,
      optionalString(body.role, 'role') as never,
    )
    return c.json(publicOutput(task))
  })

  // Manual dispatch: creates an Attempt and spawns the agent session via the harness.
  // Used by the public `ductum attempt start` path and by demo/test harnesses.
  app.post('/api/runs/dispatch', async (c) => {
    if (context.dispatchTask == null) {
      throw new ValidationError('Dispatch is not available — server started without --dispatch')
    }
    const body = await readJson<Record<string, unknown>>(c)
    const taskId = requireString(body.taskId, 'taskId')
    const agentId = requireString(body.agentId, 'agentId')
    assertDispatchPrerequisites(context, taskId, agentId)
    const run = await context.dispatchTask(taskId, agentId)
    return c.json(publicRun(decorateRunWithUi(context, run)), 201)
  })

  app.post('/api/runs/accept', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const taskId = requireString(body.taskId, 'taskId')
    const agentId = optionalString(body.agentId, 'agentId') ?? null
    assertDispatchPrerequisites(context, taskId, agentId)
    const run = acceptRun(context, {
      taskId,
      agentId,
      parentRunId: optionalString(body.parentRunId, 'parentRunId') ?? null,
      sessionId: optionalString(body.sessionId, 'sessionId') ?? null,
      heartbeatTimeoutSeconds: optionalNumber(body.heartbeatTimeoutSeconds, 'heartbeatTimeoutSeconds'),
    })
    return c.json(publicRun(decorateRunWithUi(context, run)), 201)
  })

  app.post('/api/runs/:id/complete', async (c) => {
    const body = (await readJson<Record<string, unknown>>(c).catch(() => ({}))) as Record<string, unknown>
    const runId = c.req.param('id') as never
    const fenceToken = resolveRunFence(context, runId, c.req.header(SESSION_CONTROL_TOKEN_HEADER))
    // Auto-link PR if provided (spec says complete(result, pr?))
    const pr = optionalString(body.pr, 'pr')
    assertRunCanComplete(context, runId)
    if (pr) {
      const linkFields = resolveLinkFields({ pr })
      await linkRun(context, runId, linkFields)
    }
    completeRun(context, runId, optionalString(body.result, 'result'), fenceToken)
    await requestRunSessionEnd(context, runId)
    return c.json(publicRun(decorateRunWithUi(context, requireRun(context, runId))))
  })

  // Manual clean-session fallback. `/complete` now requests teardown
  // server-side automatically, but operators can still nudge a stuck
  // run through this route. Security: no session control token is
  // required because the route only acts on a specific run id that the
  // caller must already know, and dispatcher.endSession is a no-op
  // when no live session is bound to that id.
  app.post('/api/runs/:id/end-session', async (c) => {
    const runId = c.req.param('id') as never
    if (context.repos.runs.get(runId) == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    if (context.hasActiveSession?.(runId) === false && context.routeStoredCompletion != null) {
      await context.routeStoredCompletion(runId)
    } else {
      await requestRunSessionEnd(context, runId)
    }
    return c.json(publicOutput({ ok: true }))
  })

  app.get('/api/runs/:id/updates', (c) =>
    c.json(context.repos.runUpdates.list(c.req.param('id') as never).map(publicRunUpdate)),
  )

  app.get('/api/runs/:id/activity', (c) => {
    const limitRaw = c.req.query('limit')
    const limit = limitRaw == null ? 200 : Math.max(1, Math.min(5000, Number(limitRaw) || 200))
    return c.json(context.repos.runActivity.list(c.req.param('id') as never, limit).map(publicRunActivity))
  })

  app.post('/api/runs/:id/activity', async (c) => {
    const runId = c.req.param('id') as never
    const run = context.repos.runs.get(runId)
    if (run == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    refreshScopedLiveness(context, run, c.req.header(SESSION_CONTROL_TOKEN_HEADER))
    const body = await readJson<Record<string, unknown>>(c)
    const kind = requireString(body.kind, 'kind') as never
    const content = requireString(body.content, 'content')
    const toolName = optionalString(body.toolName, 'toolName') ?? undefined
    const activity = context.repos.runActivity.create(runId, kind, content, toolName)
    context.events.emit({
      type: 'run.agent_activity',
      runId,
      kind: activity.kind,
      content: activity.content,
      toolName: activity.toolName,
    })
    return c.json(publicRunActivity(activity), 201)
  })

  app.post('/api/runs/:id/update', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    if (context.repos.runs.get(runId) == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    return c.json(publicOutput({
      runId,
      update: publicRunUpdate(recordProgress(context, runId, requireString(body.message, 'message'))),
    }))
  })

  app.post('/api/runs/:id/heartbeat', (c) => {
    const runId = c.req.param('id') as never
    const run = context.repos.runs.get(runId)
    if (run == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    refreshScopedLiveness(context, run, c.req.header(SESSION_CONTROL_TOKEN_HEADER))
    context.stateMachine.heartbeat(runId)
    return c.json(publicNullableRun(decorateNullableRunWithUi(context, context.repos.runs.get(runId))))
  })

  app.post('/api/runs/:id/decide', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const run = context.repos.runs.get(c.req.param('id') as never)
    if (run == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    const task = context.repos.tasks.get(run.taskId)
    const spec = task == null ? null : context.repos.specs.get(task.specId)
    return c.json(
      publicOutput(context.repos.decisions.create({
        id: createId<'DecisionId'>(),
        specId: spec?.id ?? null,
        taskId: task?.id ?? null,
        runId: run.id,
        decision: requireString(body.decision, 'decision'),
        context: requireString(body.context, 'context'),
        alternatives: optionalStringArray(body.alternatives, 'alternatives') ?? null,
        decidedBy: optionalString(body.decidedBy, 'decidedBy') ?? 'agent',
        supersedesId: (optionalString(body.supersedesId, 'supersedesId') ?? null) as never,
      })),
      201,
    )
  })

  /** gate-check is now a read-only workflow status query */
  app.post('/api/runs/:id/gate-check', async (c) => {
    return c.json(publicOutput(await gateCheck(context, c.req.param('id') as never)))
  })

  app.post('/api/runs/:id/fail', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const run = await failRun(
      context,
      c.req.param('id') as never,
      requireString(body.reason, 'reason'),
      body.recoverable === undefined ? true : body.recoverable === true,
    )
    return c.json(publicRun(decorateRunWithUi(context, run)))
  })

  app.post('/api/runs/:id/cancel', async (c) => {
    const runId = c.req.param('id') as never
    try {
      const body = await readJson<Record<string, unknown>>(c)
      const result = await cancelRun(context, runId, {
        reason: requireString(body.reason, 'reason'),
        cleanupWorktree: body.cleanupWorktree === true,
      })
      // D163 §7: mutating run endpoints expose a UI-decorated DTO, not
      // the raw domain run. Decorate before envelope-wrapping so the
      // dashboard never has to re-derive status/cost client-side.
      return c.json(envelope(
        'run.cancelled',
        publicOutput({ ...result, run: decorateRunWithUi(context, result.run) }),
        context.now,
      ))
    } catch (error) {
      const httpError = toHttpError(error)
      return c.json(
        publicOutput(structuredError(error, {
          code: httpError.status === 409 ? 'run_cancel_conflict' : undefined,
          recoverable: httpError.status === 409,
          context: { runId },
          now: context.now,
        })),
        httpError.status as 400 | 403 | 404 | 409 | 500,
      )
    }
  })

  app.post('/api/runs/:id/pause', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const run = await pauseRun(context, {
      runId: c.req.param('id') as never,
      reason: requireString(body.reason, 'reason'),
      decidedBy: optionalString(body.decidedBy, 'decidedBy') ?? 'operator',
    })
    return c.json(publicRun(decorateRunWithUi(context, run)))
  })

  app.post('/api/runs/:id/resume', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const result = resumePausedRun(context, {
      runId: c.req.param('id') as never,
      reason: requireString(body.reason, 'reason'),
      decidedBy: optionalString(body.decidedBy, 'decidedBy') ?? 'operator',
    })
    await kickDispatcherForReadyTask(context, 'run resume')
    return c.json(publicOutput({
      ...result,
      taskStatus: context.repos.tasks.get(result.taskId as never)?.status ?? result.taskStatus,
    }))
  })

  app.post('/api/runs/:id/redirect', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const result = await redirectRun(context, {
      runId: c.req.param('id') as never,
      agentId: requireString(body.agentId, 'agentId') as never,
      reason: requireString(body.reason, 'reason'),
      decidedBy: optionalString(body.decidedBy, 'decidedBy') ?? 'operator',
    })
    await kickDispatcherForReadyTask(context, 'run redirect')
    return c.json(publicOutput({
      ...result,
      taskStatus: context.repos.tasks.get(result.taskId as never)?.status ?? result.taskStatus,
    }))
  })

  app.post('/api/runs/:id/retry', async (c) => {
    const body = await readJson<Record<string, unknown>>(c).catch(() => ({} as Record<string, unknown>))
    const reason = optionalString(body.reason, 'reason')?.trim()
    const run = requireRun(context, c.req.param('id') as never)
    requireLatestTaskRun(context, run, 'retry')
    if (run.terminalState == null) {
      throw new ValidationError(`Can only retry failed or stalled runs, got terminal_state: ${run.terminalState}`)
    }
    context.repos.runs.updateTerminalState(run.id, 'failed')
    context.repos.runs.updateFailure(run.id, reason ? `Retried by operator: ${reason}` : 'Retried by operator', false)
    const task = context.repos.tasks.get(run.taskId)
    if (task != null) {
      const retryPrompt = buildOperatorRetryReviewPrompt(task, run.failReason ?? reason ?? 'operator retry')
      if (retryPrompt != null) context.repos.tasks.updatePrompt(task.id, retryPrompt)
      context.repos.tasks.updateRetry(task.id, 0, null)
      context.repos.tasks.updateStatus(task.id, 'ready')
      context.dag.evaluateTaskDAG(task.specId)
    }
    context.repos.runUpdates.create(
      run.id,
      reason
        ? `operator retried run; task returned to ready queue: ${reason}`
        : 'operator retried run; task returned to ready queue',
    )
    await kickDispatcherForReadyTask(context, 'run retry')
    return c.json(publicOutput({
      ok: true,
      taskId: run.taskId,
      taskStatus: context.repos.tasks.get(run.taskId)?.status ?? 'ready',
    }))
  })

  app.post('/api/runs/:id/budget-extend', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const byUsd = optionalNumber(body.by ?? body.byUsd, 'by')
    if (byUsd == null) throw new ValidationError('budget-extend: body.by (USD) is required')
    const reason = optionalString(body.reason, 'reason') ?? null
    const decidedBy = optionalString(body.decidedBy, 'decidedBy') ?? 'operator'
    const result = extendBudget(context, { runId, byUsd, reason, decidedBy })
    await kickDispatcherForReadyTask(context, 'budget extension')
    return c.json(publicOutput(result))
  })

  app.post('/api/runs/:id/budget-deny', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const reason = requireString(body.reason, 'reason')
    const decidedBy = optionalString(body.decidedBy, 'decidedBy') ?? 'operator'
    return c.json(publicOutput(denyBudget(context, { runId, reason, decidedBy })))
  })

  app.post('/api/runs/:id/turns-extend', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const byCount = optionalNumber(body.by ?? body.byCount, 'by')
    if (byCount == null) throw new ValidationError('turns-extend: body.by (turn count) is required')
    const reason = optionalString(body.reason, 'reason') ?? null
    const decidedBy = optionalString(body.decidedBy, 'decidedBy') ?? 'operator'
    const result = extendTurns(context, { runId, byCount, reason, decidedBy })
    await kickDispatcherForReadyTask(context, 'turn extension')
    return c.json(publicOutput(result))
  })

  app.post('/api/runs/:id/turns-deny', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const reason = requireString(body.reason, 'reason')
    const decidedBy = optionalString(body.decidedBy, 'decidedBy') ?? 'operator'
    return c.json(publicOutput(denyTurns(context, { runId, reason, decidedBy })))
  })

  app.post('/api/runs/:id/evidence', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const run = requireRun(context, c.req.param('id') as never)
    const fenceToken = resolveRunFence(context, run.id, c.req.header(SESSION_CONTROL_TOKEN_HEADER))
    const requestedType = requireString(body.type, 'type')
    const payload = sanitizeRouteEvidencePayload(optionalRecord(body.payload, 'payload') ?? {})
    const type = requestedType === 'best-of-n-verdict' && payload.kind === 'best-of-n-verdict'
      ? 'custom'
      : requestedType
    validateEvidencePayload(context, run, type, payload)
    return c.json(
      publicEvidence(addEvidence(
        context,
        run.id,
        type as never,
        payload,
        fenceToken,
      )),
      201,
    )
  })

  app.post('/api/runs/:id/link', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const run = await linkRun(context, runId, resolveLinkFieldsForRun(context, requireRun(context, runId), body))
    return c.json(publicRun(decorateRunWithUi(context, run)))
  })

  app.get('/api/tasks/:taskId/context', (c) => c.json(publicOutput(getTaskContext(context, c.req.param('taskId')))))

  app.post('/api/runs/:id/approve', async (c) => {
    // Returns the ApproveRunResult structured payload.
    // Merge conflicts land as { success: false, stage: 'ship',
    // reason: '...' } with HTTP 200 so the dashboard can render the
    // failure inline without losing the approval row.
    const body = await readJson<Record<string, unknown>>(c).catch(() => ({} as Record<string, unknown>))
    const reason = optionalString(body.reason, 'reason')?.trim()
    const unattended = body.unattended === true
    if (unattended) {
      const authFailure = requireUnattendedOperatorAuth(c, context)
      if (authFailure != null) return authFailure
    }
    const result = await approveRun(context, c.req.param('id') as never, { ...(reason ? { reason } : {}), unattended })
    const runAfter = context.repos.runs.get(c.req.param('id') as never)
    return c.json(publicOutput({ ...result, run: publicNullableRun(decorateNullableRunWithUi(context, runAfter)) }))
  })

  // Decision 122 (P3.2): one-click rebase + verify + re-approve flow
  // for stale-branch approvals. The body is optional — `{ base }` lets
  // the operator override the merge base; otherwise context.merge.base
  // (default 'main') is used. On rebase conflict the response carries
  // `fixRebaseTaskId` so the dashboard/CLI can point at the dispatched
  // recovery task.
  app.post('/api/runs/:id/approve-rebase', async (c) => {
    const body = await readJson<Record<string, unknown>>(c).catch(() => ({} as Record<string, unknown>))
    const base = optionalString(body.base, 'base') ?? undefined
    const result = await approveRunWithRebase(context, c.req.param('id') as never, base != null ? { base } : {})
    const runAfter = context.repos.runs.get(c.req.param('id') as never)
    return c.json(publicOutput({ ...result, run: publicNullableRun(decorateNullableRunWithUi(context, runAfter)) }))
  })

  app.post('/api/runs/:id/reject', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const reason = requireString(body.reason, 'reason')
    const run = await rejectRun(context, c.req.param('id') as never, reason)
    return c.json(publicRun(decorateRunWithUi(context, run)))
  })

  app.post('/api/runs/reconcile', async (c) => {
    // Walk every active run + active task and bring inconsistent state
    // into agreement with git history (zombie ship-stage runs whose
    // merge already happened, tasks left active after every run failed).
    // Body fields all optional: { base, dryRun }.
    const body = await readJson<Record<string, unknown>>(c).catch(() => ({} as Record<string, unknown>))
    const base = optionalString(body.base, 'base') ?? undefined
    const dryRun = body.dryRun === true
    const maxPasses = optionalNumber(body.maxPasses, 'maxPasses') ?? undefined
    const result = await reconcileInconsistentRuns(context, { base, dryRun, maxPasses })
    return c.json(publicOutput(result))
  })

  registerRunControlRoutes(app, context)
}

function refreshScopedLiveness(
  context: ApiContext,
  run: Run,
  controlToken: string | undefined,
): void {
  const fenceToken = resolveRunFence(context, run.id, controlToken)
  if (fenceToken == null) return
  context.repos.attemptLeases.renew({
    runId: run.id,
    fenceToken,
    ttlMs: run.heartbeatTimeoutSeconds * 2_000,
    now: context.now(),
  })
}

function assertDispatchPrerequisites(context: ApiContext, taskId: string, agentId: string | null | undefined): void {
  if (context.getDispatcherStatus == null) {
    if (context.requireDispatchPrerequisiteContext === true) {
      throw new ValidationError('Dispatch prerequisite context is unavailable; refusing to start an Attempt without readiness checks.')
    }
    return
  }
  const task = context.repos.tasks.get(taskId as never)
  const resolvedAgentId = agentId ?? task?.assignedAgentId ?? null
  const agent = resolvedAgentId == null ? null : context.repos.agents.get(resolvedAgentId as never)
  if (task == null || agent == null) return
  const issues = buildApiTaskPrerequisiteIssues(context, task, agent)
  if (issues.length > 0) throw new PrerequisiteCheckError(issues)
}

function validateEvidencePayload(
  context: ApiContext,
  run: Run,
  type: string,
  payload: Record<string, unknown>,
): void {
  if (type === 'exit_demo.run') {
    if (!validateTypedEvidencePayload(payload) || payload.kind !== 'exit_demo.run') {
      throw new ValidationError('Invalid exit_demo.run evidence payload')
    }
    return
  }
  if (type !== 'custom') return
  const kind = optionalString(payload.kind, 'payload.kind')
  if (kind == null || !CUSTOM_EVIDENCE_KINDS.has(kind)) {
    throw new ValidationError(
      `Invalid custom evidence kind. Must be one of: ${Array.from(CUSTOM_EVIDENCE_KINDS).join(', ')}`,
    )
  }
  if (payload.kind === 'external-outcome' && !isExternalOutcome(payload.outcome)) {
    throw new ValidationError('Invalid external outcome. Must be one of: done, fixed, superseded')
  }
  if (payload.kind === 'bakeoff-candidate-outcome' && !isBakeoffCandidateOutcome(payload.outcome)) {
    throw new ValidationError(
      'Invalid bakeoff candidate outcome. Must be one of: accepted, accepted-with-fixes, rejected, fixed, superseded',
    )
  }
  if (payload.kind === 'external-outcome' || payload.kind === 'bakeoff-candidate-outcome') {
    requireString(payload.reason, 'payload.reason')
  }
  if (payload.kind === 'external-outcome') {
    requireLatestTaskRun(context, run, 'record external outcome on')
    if (run.stage !== 'done') {
      throw new ConflictError(`External outcome evidence requires run ${run.id} to already be done`)
    }
  }
  if (
    payload.kind !== 'external-outcome' &&
    payload.kind !== 'bakeoff-candidate-outcome' &&
    payload.kind !== 'verify' &&
    payload.kind !== 'internal-review' &&
    customPayloadHasSuccessSignal(payload)
  ) {
    throw new ValidationError('Success-looking custom prose evidence is not accepted as execution outcome evidence')
  }
}
