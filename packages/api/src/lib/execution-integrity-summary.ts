import { isPrimaryTaskExecutionIssueCode, type ExecutionMode } from '@ductum/core'

import type {
  ExecutionIntegrityFields,
  ExecutionIntegrityIssueSample,
  ExecutionIntegrityRunEntry,
  ExecutionIntegritySummary,
  ExecutionIntegrityTaskEntry,
} from './execution-integrity.js'

const SUMMARY_ISSUE_SAMPLE_LIMIT = 10

export function buildExecutionIntegritySummary(entries: {
  tasks: ExecutionIntegrityTaskEntry[]
  runs: ExecutionIntegrityRunEntry[]
}): ExecutionIntegritySummary {
  const taskIssues = collectTaskIssueSamples(entries.tasks)
  const runIssues = collectRunIssueSamples(entries.runs)
  const samples = interleaveIssueSamples(taskIssues, runIssues, SUMMARY_ISSUE_SAMPLE_LIMIT)
  const issueCount = taskIssues.length + runIssues.length
  return {
    taskCount: entries.tasks.length,
    runCount: entries.runs.length,
    issueCount,
    taskIssueCount: taskIssues.length,
    runIssueCount: runIssues.length,
    taskModes: countModes(entries.tasks),
    runModes: countModes(entries.runs),
    issues: samples,
    issuesTruncated: issueCount > samples.length,
  }
}

function collectTaskIssueSamples(tasks: readonly ExecutionIntegrityTaskEntry[]): ExecutionIntegrityIssueSample[] {
  const samples: ExecutionIntegrityIssueSample[] = []
  for (const task of tasks) {
    for (const issue of task.executionIssues) {
      if (!isPrimaryTaskExecutionIssueCode(issue.code)) continue
      samples.push({
        scope: 'task',
        id: task.taskId,
        projectName: task.projectName,
        specName: task.specName,
        taskName: task.taskName,
        runId: null,
        executionMode: task.executionMode,
        issueCode: issue.code,
        issueMessage: issue.message,
        status: task.taskStatus,
      })
    }
  }
  return samples
}

function collectRunIssueSamples(runs: readonly ExecutionIntegrityRunEntry[]): ExecutionIntegrityIssueSample[] {
  const samples: ExecutionIntegrityIssueSample[] = []
  for (const run of runs) {
    for (const issue of run.executionIssues) {
      samples.push({
        scope: 'run',
        id: run.runId,
        projectName: run.projectName,
        specName: run.specName,
        taskName: run.taskName,
        runId: run.runId,
        executionMode: run.executionMode,
        issueCode: issue.code,
        issueMessage: issue.message,
        status: run.terminalState ?? run.stage,
      })
    }
  }
  return samples
}

function interleaveIssueSamples(
  taskIssues: readonly ExecutionIntegrityIssueSample[],
  runIssues: readonly ExecutionIntegrityIssueSample[],
  limit: number,
): ExecutionIntegrityIssueSample[] {
  const samples: ExecutionIntegrityIssueSample[] = []
  let taskIndex = 0
  let runIndex = 0
  while (samples.length < limit && (taskIndex < taskIssues.length || runIndex < runIssues.length)) {
    if (taskIndex < taskIssues.length) samples.push(taskIssues[taskIndex++]!)
    if (samples.length >= limit) break
    if (runIndex < runIssues.length) samples.push(runIssues[runIndex++]!)
  }
  return samples
}

function countModes(entries: readonly ExecutionIntegrityFields[]): Record<ExecutionMode, number> {
  const counts: Record<ExecutionMode, number> = {
    orchestrated: 0,
    external: 0,
    recorded: 0,
    unknown: 0,
    inconsistent: 0,
  }
  for (const entry of entries) counts[entry.executionMode] += 1
  return counts
}
