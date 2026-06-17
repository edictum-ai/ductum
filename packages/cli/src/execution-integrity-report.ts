import { isPrimaryTaskExecutionIssueCode } from '@ductum/core'

import type { ExecutionIntegrityReport } from './execution-integrity-types.js'

const EXECUTION_MODES = ['orchestrated', 'external', 'recorded', 'unknown', 'inconsistent'] as const

export function normalizeExecutionIntegrityReport(
  report: ExecutionIntegrityReport,
): { ok: true; report: ExecutionIntegrityReport } | { ok: false; text: string } {
  if (!hasModeCounts(report.summary?.taskModes) || !hasModeCounts(report.summary?.runModes) || !Array.isArray(report.tasks) || !Array.isArray(report.runs)) {
    return {
      ok: false,
      text: [
        'Execution integrity',
        'missing:    API response is missing required integrity report fields',
        'next:       restart or upgrade the Ductum API before trusting execution integrity output',
      ].join('\n'),
    }
  }

  return {
    ok: true,
    report: {
      ...report,
      summary: {
        ...report.summary,
        taskIssueCount: report.summary.taskIssueCount ?? countTaskIssues(report),
        runIssueCount: report.summary.runIssueCount ?? countRunIssues(report),
        issues: report.summary.issues ?? [],
        issuesTruncated: report.summary.issuesTruncated ?? false,
      },
    },
  }
}

function hasModeCounts(value: unknown): value is ExecutionIntegrityReport['summary']['taskModes'] {
  if (value == null || typeof value !== 'object') return false
  return EXECUTION_MODES.every((mode) => typeof (value as Record<string, unknown>)[mode] === 'number')
}

function countTaskIssues(report: ExecutionIntegrityReport): number {
  return report.tasks.flatMap((task) => task.executionIssues).filter((issue) => isPrimaryTaskExecutionIssueCode(issue.code)).length
}

function countRunIssues(report: ExecutionIntegrityReport): number {
  return report.runs.flatMap((run) => run.executionIssues).length
}
