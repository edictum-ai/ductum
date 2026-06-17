import { Command } from 'commander'
import type { RepairItem, RepairReport } from '@ductum/core'

import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { buildLogsCommand, buildRetryCommand, buildStatusCommand, buildWatchCommand, withDuctum } from './attempt-actions.js'
import { listNeedsOperatorRuns, loadWorkspaceSnapshot, type RunRecord } from './status-data.js'
import { formatAttemptPhase } from './status-overview.js'

export function registerRepairCommands(program: Command, deps: CliProgramDeps) {
  const repair = program.command('repair').description('List setup, readiness, and Attempt recovery items')
  repair
    .command('list', { isDefault: true })
    .description('List Repair items grouped by what they block')
    .action(createAction(deps, async (ctx) => {
      const [report, snapshot] = await Promise.all([
        ctx.api.getRepairReport(),
        loadWorkspaceSnapshot(ctx.api).catch(() => null),
      ])
      const recovery = snapshot == null ? null : listNeedsOperatorRuns(snapshot, ctx.now())
      ctx.write({ ...report, recovery }, renderRepairReport(report, recovery))
    }))
}

function renderRepairReport(report: RepairReport, recovery: RunRecord[] | null): string {
  if (report.items.length === 0) return 'Repair\nNo setup, readiness, or Attempt recovery items found.'
  const lines = [
    'Repair',
    `items: ${report.summary.total}`,
    `blockers: ${report.summary.blockers}`,
    `attention: ${report.summary.attention}`,
  ]
  for (const group of report.groups) {
    lines.push('', group.label, `  blocks: ${group.blocks}`)
    if (group.area === 'attempt_recovery') {
      lines.push(...renderRecoveryDetails(recovery))
    }
    for (const item of group.items) lines.push(...renderItem(item, recovery))
  }
  return lines.join('\n')
}

function renderItem(item: RepairItem, recovery: RunRecord[] | null): string[] {
  const recordName = item.record.name == null ? item.record.type : `${item.record.type} ${item.record.name}`
  const lines = [
    `  - ${item.title}`,
    `    severity: ${item.severity}`,
    `    record: ${recordName}${item.record.id == null ? '' : ` (${item.record.id})`}`,
    `    field: ${item.field.label} (${item.field.path})`,
    `    value: ${item.field.value ?? item.status}`,
    `    reason: ${item.reason}`,
    `    action: ${item.suggestedAction}`,
  ]
  return lines
}

function renderRecoveryDetails(recovery: RunRecord[] | null): string[] {
  if (recovery == null) {
    return ['    attempts: unavailable from workspace snapshot; run `ductum status` for current Attempt detail.']
  }
  if (recovery.length === 0) {
    return ['    attempts: no current failed or stalled active-task Attempts found.']
  }
  return [
    '    attempts:',
    ...recovery.flatMap((record) => [
      `      - attempt: ${record.run.id}`,
      `        project: ${record.project.name}`,
      `        spec: ${record.spec.name}`,
      `        task: ${record.task.name}`,
      `        status: ${formatAttemptPhase(record.derivedStage)}`,
      `        reason: ${record.run.failReason ?? record.run.blockedReason ?? `${formatAttemptPhase(record.derivedStage)} attempt has no live sibling working this active Task.`}`,
      `        next: ${withDuctum(buildStatusCommand(record.run.id))} | ${withDuctum(buildLogsCommand(record.run.id))} | ${withDuctum(buildWatchCommand(record.run.id))} | ${withDuctum(buildRetryCommand(record.run.id))}`,
    ]),
  ]
}
