import { Command } from 'commander'

import { formatDisplayStatus, formatSummaryRows, formatTable } from '../format.js'
import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { formatRunCost, renderSections } from './common.js'
import { findDirtyWorktreeEvidence, renderDirtyWorktreeSection } from './dirty-worktree.js'
import { buildStatusOverview, formatAttemptPhase, renderStatusOverview, titleLabel } from './status-overview.js'
import { findRunRecord, loadWorkspaceSnapshot } from './status-data.js'

export function registerStatusCommands(program: Command, deps: CliProgramDeps) {
  program
    .command('status [attemptId]')
    .description('Show Project, Factory Activity, or Attempt status')
    .action(createAction(deps, async (ctx, attemptId?: string) => {
      if (attemptId == null) {
        const snapshot = await loadWorkspaceSnapshot(ctx.api)
        const payload = buildStatusOverview(snapshot, ctx.now())
        ctx.writeEnvelope('status.overview', payload, renderStatusOverview(payload))
        return
      }

      const [snapshot, run, history, evidence, gateEvaluations] = await Promise.all([
        loadWorkspaceSnapshot(ctx.api),
        ctx.api.getAttempt(attemptId),
        ctx.api.getRunHistory(attemptId),
        ctx.api.getRunEvidence(attemptId),
        ctx.api.getRunGateEvaluations(attemptId),
      ])
      const record = findRunRecord(snapshot, attemptId, ctx.now())
      const dashboardUrl = resolveDashboardUrl(ctx.env)
      const url = `${dashboardUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(run.id)}`
      const dirtyWorktree = findDirtyWorktreeEvidence(evidence)
      const payload = { run, record, history, evidence, gateEvaluations, url }
      ctx.writeEnvelope('status.attempt', payload, renderSections(
        formatSummaryRows({
          attemptId: run.id,
          status: formatDisplayStatus(run),
          phase: formatAttemptPhase(record?.derivedStage ?? run.stage),
          task: record?.task.name ?? run.taskId,
          project: record?.project.name ?? '',
          agent: record?.agent?.name ?? run.agentId,
          branch: run.branch ?? '',
          commitSha: run.commitSha ?? '',
          prUrl: run.prUrl ?? '',
          costUsd: formatRunCost(run),
          tokensIn: run.tokensIn,
          tokensOut: run.tokensOut,
        }),
        `Attempt History\n${formatTable([
          { key: 'fromStage', label: 'FROM' },
          { key: 'toStage', label: 'TO' },
          { key: 'reason', label: 'REASON' },
          { key: 'createdAt', label: 'AT' },
        ], history.map((item) => ({
          ...item,
          fromStage: formatAttemptPhase(item.fromStage),
          toStage: formatAttemptPhase(item.toStage),
        })))}`,
        `Evidence\n${formatTable([
          { key: 'type', label: 'TYPE' },
          { key: 'payload', label: 'PAYLOAD' },
          { key: 'createdAt', label: 'AT' },
        ], evidence.map((item) => ({ ...item, type: titleLabel(item.type), payload: JSON.stringify(item.payload) })))}`,
        `Gate Checks\n${formatTable([
          { key: 'gateType', label: 'GATE' },
          { key: 'target', label: 'PHASE' },
          { key: 'result', label: 'RESULT' },
          { key: 'reason', label: 'REASON' },
        ], gateEvaluations.map((item) => ({
          ...item,
          gateType: titleLabel(item.gateType),
          target: formatAttemptPhase(item.target),
          result: titleLabel(item.result),
        })))}`,
        ...(dirtyWorktree == null ? [] : [renderDirtyWorktreeSection(dirtyWorktree)]),
        ...(run.failReason?.startsWith('prompt_overflow') ? ['Hint\n  the prompt may have grown too large; consider splitting the task.'] : []),
      ))
    }))
}

const resolveDashboardUrl = (env: Record<string, string | undefined>): string => env.DUCTUM_DASHBOARD_URL ?? 'http://localhost:5176'
