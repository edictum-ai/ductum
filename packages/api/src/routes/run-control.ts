import { computeCacheAwareCost } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { ValidationError } from '../lib/errors.js'
import { optionalNumber, optionalRecord, optionalString, readJson, requireString } from '../lib/http.js'
import { resolveRunFence, resolveSessionFence } from '../lib/lease-fence.js'
import { authorizeTool, enforceCostBudget, getPluginProbeStatus, precheckCostBudget, recordPluginProbe, reportToolSuccess, resolveScannerSnapshot } from '../lib/run-ops.js'
import { decorateNullableRunWithUi, decorateRunWithUi } from '../lib/run-ui-context.js'
import { publicNullableRun, publicOutput, publicRun } from '../lib/public-output.js'
import { requireSessionControl, SESSION_CONTROL_TOKEN_HEADER } from '../lib/session-control.js'

export function registerRunControlRoutes(app: Hono, context: ApiContext) {
  app.post('/api/internal/authorize-tool', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const mapping = requireAuthorizedSession(context, c.req.header(SESSION_CONTROL_TOKEN_HEADER), body)
    const fenceToken = resolveSessionFence(context, mapping)
    return c.json(
      await authorizeTool(
        context,
        mapping.runId,
        requireString(body.tool, 'tool'),
        optionalRecord(body.args, 'args') ?? {},
        fenceToken,
      ),
    )
  })

  app.post('/api/internal/report-tool-success', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const mapping = requireAuthorizedSession(context, c.req.header(SESSION_CONTROL_TOKEN_HEADER), body)
    const fenceToken = resolveSessionFence(context, mapping)
    await reportToolSuccess(
      context,
      mapping.runId,
      requireString(body.tool, 'tool'),
      optionalRecord(body.args, 'args') ?? {},
      fenceToken,
    )
    return c.json(publicOutput({ ok: true }))
  })

  app.post('/api/runs/:id/reset', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const targetStage = optionalString(body.targetStage, 'targetStage') ?? 'implement'
    await context.enforcement.resetToStage(c.req.param('id') as never, targetStage)
    return c.json(publicNullableRun(decorateNullableRunWithUi(context, context.repos.runs.get(c.req.param('id') as never))))
  })

  app.post('/api/runs/:id/tokens', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const fenceToken = resolveRunFence(context, runId)
    const tokensIn = optionalNumber(body.tokensIn, 'tokensIn') ?? 0
    const tokensOut = optionalNumber(body.tokensOut, 'tokensOut') ?? 0
    // Cache fields are optional — harnesses that don't track caching
    // (opencode, older codex-app-server) will leave them at 0 and the
    // cache-aware path degrades to the flat-rate path transparently.
    const cachedTokensIn = optionalNumber(body.cachedTokensIn, 'cachedTokensIn') ?? 0
    const cacheCreationTokensIn = optionalNumber(body.cacheCreationTokensIn, 'cacheCreationTokensIn') ?? 0

    // Cost resolution order (highest precedence first):
    //   1. Local-log scanner — if the harness has reported its session
    //      id and the matching codex/claude jsonl is on disk, the
    //      scanner returns cache-aware totals that match what the
    //      provider actually billed. We REPLACE the run's snapshot
    //      with the scanner numbers and skip the delta path entirely.
    //   2. Per-agent pricing override (subscription rate) applied to
    //      the harness-reported delta (cache-unaware — the override
    //      schema doesn't model caching).
    //   3. Cache-aware delta path: CODEX_RATES/CLAUDE_RATES scanner
    //      tables applied to the harness-reported (gross, cached,
    //      cacheCreation) split. Matches the scanner dollar-for-dollar
    //      when both apply to the same token counts.
    //   4. OpenRouter live → static fallback table.
    //
    // Codex hardcodes costUsd=0 in its events and Anthropic's field
    // drifts from published rates, so harness-reported cost is always
    // ignored regardless of which path we take.
    const run = context.repos.runs.get(runId)
    const agent = run != null ? context.repos.agents.get(run.agentId) : null
    const scannerSnapshot = run != null
      ? resolveScannerSnapshot(context, runId)
      : null

    // Compute projected cost first so we can refuse the write entirely
    // if it would cross the hard cap. Without this, a single delta of
    // hundreds of thousands of tokens overshoots the cap and we only
    // notice afterwards.
    let projectedTotalUsd: number
    let snapshotMode: 'scanner' | 'delta'
    let deltaCostUsd = 0
    if (scannerSnapshot != null) {
      projectedTotalUsd = scannerSnapshot.costUsd
      snapshotMode = 'scanner'
    } else {
      deltaCostUsd = computeCacheAwareCost(
        agent?.model ?? null,
        tokensIn,
        tokensOut,
        cachedTokensIn,
        cacheCreationTokensIn,
        agent?.pricing ?? undefined,
      )
      projectedTotalUsd = (run?.costUsd ?? 0) + deltaCostUsd
      snapshotMode = 'delta'
    }

    const killed = await precheckCostBudget(context, runId, projectedTotalUsd)
    if (killed) {
      // Refuse the write — the run is already marked failed and the
      // session has been killed. Return the current row so the harness
      // sees the terminal state.
      return c.json(publicNullableRun(decorateNullableRunWithUi(context, context.repos.runs.get(runId))) ?? {})
    }

    let updated
    if (snapshotMode === 'scanner' && scannerSnapshot != null) {
      // Display the GROSS input total (uncached + cached) on the run
      // record to match what the harness reports — the cost field is
      // already cache-aware, so this only affects the token columns
      // shown in the dashboard.
      const scannerTokensIn = scannerSnapshot.inputTokens + scannerSnapshot.cachedInputTokens + scannerSnapshot.cacheCreationInputTokens
      updated = fenceToken != null && context.repos.runs.setTokensFenced != null
        ? context.repos.runs.setTokensFenced(runId, scannerTokensIn, scannerSnapshot.outputTokens, scannerSnapshot.costUsd, fenceToken, context.now())
        : context.repos.runs.setTokens(runId, scannerTokensIn, scannerSnapshot.outputTokens, scannerSnapshot.costUsd)
    } else {
      updated = fenceToken != null && context.repos.runs.updateTokensFenced != null
        ? context.repos.runs.updateTokensFenced(runId, tokensIn, tokensOut, deltaCostUsd, fenceToken, context.now())
        : context.repos.runs.updateTokens(runId, tokensIn, tokensOut, deltaCostUsd)
    }
    // Belt-and-suspenders: also run the post-write check so the warn
    // threshold fires (precheck only handles hard caps).
    await enforceCostBudget(context, runId)
    return c.json(publicRun(decorateRunWithUi(context, updated)))
  })

  app.post('/api/runs/:id/harness-session-id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const runId = c.req.param('id') as never
    const harnessSessionId = requireString(body.harnessSessionId, 'harnessSessionId')
    const mapping = context.repos.sessionRunMappings.getByRunId(runId)
    if (mapping == null) {
      return c.json(publicOutput({
        ok: false,
        reason: 'mapping_not_ready',
        harnessSessionId,
      }), 202)
    }
    const updated = context.repos.sessionRunMappings.updateHarnessSessionId(
      mapping.sessionId,
      harnessSessionId,
    )
    return c.json(publicOutput({ ok: true, harnessSessionId: updated.harnessSessionId }))
  })

  /** @deprecated Latch system replaced by Edictum workflow stages */
  app.post('/api/runs/:id/resolve-latch', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const latch = requireString(body.latch, 'latch')
    const status = requireString(body.status, 'status')
    if (status === 'fail') {
      await context.enforcement.resetToStage(c.req.param('id') as never, 'implement')
    }
    return c.json(publicNullableRun(decorateNullableRunWithUi(context, context.repos.runs.get(c.req.param('id') as never))))
  })

  app.get('/api/internal/plugin-probe', (c) => {
    const sessionId = c.req.query('session_id')
    if (sessionId == null || sessionId === '') {
      throw new ValidationError('session_id is required')
    }
    if (c.req.query('mark') === '1' || c.req.query('mark') === 'true') {
      recordPluginProbe(context, sessionId)
    }
    return c.json(publicOutput(getPluginProbeStatus(context, sessionId)))
  })
}

function requireAuthorizedSession(
  context: ApiContext,
  controlToken: string | undefined,
  body: Record<string, unknown>,
) {
  const sessionId = optionalString(body.sessionId, 'sessionId') ?? optionalString(body.session_id, 'session_id')
  if (sessionId == null) {
    throw new ValidationError('sessionId is required')
  }
  return requireSessionControl(context, sessionId, requireControlToken(controlToken))
}

function requireControlToken(controlToken: string | undefined): string {
  if (controlToken == null || controlToken === '') {
    throw new ValidationError(`${SESSION_CONTROL_TOKEN_HEADER} is required`)
  }
  return controlToken
}
