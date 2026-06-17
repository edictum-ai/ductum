import type { Run, RunActivity, RunUpdate } from '@ductum/core'
import { Command } from 'commander'

import { formatDisplayStatus, formatSummaryRows, formatTable } from '../format.js'
import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { renderSections } from './common.js'
import { formatAttemptPhase } from './status-overview.js'

export function registerTranscriptCommand(program: Command, deps: CliProgramDeps) {
  program
    .command('logs <attemptId>')
    .option('--limit <count>', 'Maximum activity rows to print', '80')
    .option('--raw', 'Print full activity content instead of previews', false)
    .description('Show an Attempt transcript: progress updates, tool calls, text, and result messages')
    .action(createAction(deps, async (ctx, runId: string, options: { limit: string; raw: boolean }) => {
      const limit = parseLimit(options.limit)
      const [run, updates, activity] = await Promise.all([
        ctx.api.getRun(runId),
        ctx.api.getRunUpdates(runId),
        ctx.api.getRunActivity(runId, limit),
      ])
      const rows = activity.map((item) => activityRow(item, options.raw))
      const next = nextAction(run)
      ctx.write({ run, updates, activity }, renderSections(
        formatSummaryRows({
          attemptId: run.id,
          status: formatDisplayStatus(run),
          phase: formatAttemptPhase(run.stage),
          result: run.terminalState == null ? '' : formatAttemptPhase(run.terminalState),
          branch: run.branch ?? '',
          prUrl: run.prUrl ?? '',
        }),
        `Progress\n${formatTable([
          { key: 'time', label: 'TIME' },
          { key: 'message', label: 'MESSAGE' },
        ], updates.map(updateRow))}`,
        `Activity\n${formatTable([
          { key: 'time', label: 'TIME' },
          { key: 'kind', label: 'KIND' },
          { key: 'tool', label: 'TOOL' },
          { key: 'content', label: 'CONTENT' },
        ], rows)}`,
        next == null ? '' : `Next\n${next}`,
      ))
    }))
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --limit: ${value}`)
  return Math.min(parsed, 5000)
}

function updateRow(update: RunUpdate) {
  return { time: isoTime(update.createdAt), message: oneLine(update.message, 180) }
}

function activityRow(activity: RunActivity, raw: boolean) {
  return {
    time: isoTime(activity.createdAt),
    kind: activity.kind,
    tool: activity.toolName ?? '',
    content: raw ? activity.content : summarizeActivity(activity),
  }
}

function summarizeActivity(activity: RunActivity): string {
  if (activity.kind === 'tool_call') return oneLine(toolCallPreview(activity.content), 180)
  return oneLine(activity.content, 180)
}

function toolCallPreview(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (typeof parsed.command === 'string') return parsed.command
    if (typeof parsed.file_path === 'string') return parsed.file_path
    if (typeof parsed.pattern === 'string') return parsed.pattern
  } catch {
    // fall through to raw content
  }
  return content
}

function nextAction(run: Run): string | null {
  if (run.pendingApproval) return `ductum approve ${run.id} or ductum deny ${run.id} --reason <reason>`
  if (run.terminalState === 'failed' || run.terminalState === 'stalled') return `ductum retry ${run.id}`
  if (run.stage !== 'done') return `ductum watch ${run.id}`
  return null
}

function isoTime(value: string): string {
  return new Date(value).toISOString().slice(11, 19)
}

function oneLine(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}
