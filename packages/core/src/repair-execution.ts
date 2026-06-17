import type { PrerequisiteIssue } from './repair-types.js'
import { recordRef, repairItem } from './repair-utils.js'

export interface RepairExecutionIssue {
  code: string
  message?: string
}

export interface RepairExecutionRunEntry {
  runId: string
  taskId: string
  taskName: string
  specName: string
  projectName: string
  executionIssues: RepairExecutionIssue[]
}

export interface RepairExecutionTaskEntry {
  taskId: string
  taskName: string
  taskStatus: string
  specId: string
  specName: string
  projectName: string
  runIds: string[]
  executionIssues: RepairExecutionIssue[]
}

export interface RepairExecutionInput {
  runs?: RepairExecutionRunEntry[]
  tasks?: RepairExecutionTaskEntry[]
}

const PRIMARY_TASK_ISSUE_CODES = new Set([
  'done_task_without_lineage_or_external_outcome',
  'bakeoff_candidate_without_outcome',
])

const ISSUE_LABEL: Record<string, string> = {
  done_run_without_lineage_or_external_outcome: 'Completed attempt has no execution lineage',
  done_task_without_lineage_or_external_outcome: 'Completed task has no traceable attempt',
  external_outcome_on_non_done_run: 'External outcome on an unfinished attempt',
  final_evidence_on_non_done_run: 'Final evidence on an unfinished attempt',
  prose_success_signal_on_non_done_run: 'Success-looking notes on an unfinished attempt',
  invalid_external_outcome: 'Invalid external outcome value',
  invalid_bakeoff_candidate_outcome: 'Invalid bakeoff outcome value',
  linked_commit_without_lineage: 'Linked commit has no execution lineage',
  bakeoff_candidate_without_outcome: 'Bakeoff candidate has no decision',
}

const ISSUE_REASON: Record<string, string> = {
  done_run_without_lineage_or_external_outcome:
    'This attempt is marked done, but Ductum has no session, worktree, or commit for it and no recorded external outcome, so the completion is not traceable.',
  done_task_without_lineage_or_external_outcome:
    'This task is marked done, but no attempt carries Ductum lineage and no external outcome is recorded.',
  external_outcome_on_non_done_run:
    'An external outcome was recorded on an attempt that has not finished.',
  final_evidence_on_non_done_run:
    'This attempt carries structured final verification or review evidence but is not marked done.',
  prose_success_signal_on_non_done_run:
    'This attempt has notes that read like success but it is not done.',
  invalid_external_outcome:
    'The external outcome recorded on this attempt is not one of the accepted values.',
  invalid_bakeoff_candidate_outcome:
    'The bakeoff outcome recorded on this attempt is not an accepted value.',
  linked_commit_without_lineage:
    'This attempt references a commit but has no Ductum session or worktree lineage and no external outcome.',
  bakeoff_candidate_without_outcome:
    'This bakeoff candidate finished without an explicit accept, reject, or fix decision.',
}

const ISSUE_ACTION: Record<string, string> = {
  done_run_without_lineage_or_external_outcome:
    'Open the attempt and record an external outcome, or start a new attempt so it carries real execution lineage.',
  done_task_without_lineage_or_external_outcome:
    'Open the task and record an external outcome, or start a new attempt so it carries Ductum lineage.',
  external_outcome_on_non_done_run: 'Finish or close the attempt, or remove the premature external outcome.',
  final_evidence_on_non_done_run: 'Advance the attempt to done, or re-check why it stopped before completion.',
  prose_success_signal_on_non_done_run: 'Confirm the real status and advance or close the attempt.',
  invalid_external_outcome: 'Re-record the external outcome using one of the accepted values.',
  invalid_bakeoff_candidate_outcome: 'Re-record the bakeoff outcome using one of the accepted values.',
  linked_commit_without_lineage:
    'Record an external outcome or start a new attempt so the commit ties to traceable execution.',
  bakeoff_candidate_without_outcome: 'Open the task and record the bakeoff decision.',
}

const ISSUE_FIELD: Record<string, string> = {
  done_run_without_lineage_or_external_outcome: 'execution lineage / external-outcome evidence',
  done_task_without_lineage_or_external_outcome: 'execution lineage / external-outcome evidence',
  external_outcome_on_non_done_run: 'external-outcome evidence',
  final_evidence_on_non_done_run: 'final verification / review evidence',
  prose_success_signal_on_non_done_run: 'completion evidence',
  invalid_external_outcome: 'external-outcome evidence',
  invalid_bakeoff_candidate_outcome: 'bakeoff-candidate-outcome evidence',
  linked_commit_without_lineage: 'commit lineage',
  bakeoff_candidate_without_outcome: 'bakeoff-candidate-outcome evidence',
}

export function buildExecutionRepairItems(input?: RepairExecutionInput): PrerequisiteIssue[] {
  if (input == null) return []
  return [
    ...(input.runs ?? []).flatMap((run) => run.executionIssues.map((issue) => runRepairItem(run, issue))),
    ...(input.tasks ?? []).flatMap((task) =>
      task.executionIssues
        .filter((issue) => PRIMARY_TASK_ISSUE_CODES.has(issue.code))
        .map((issue) => taskRepairItem(task, issue)),
    ),
  ]
}

export function executionIssueLabel(code: string): string {
  return ISSUE_LABEL[code] ?? humanizeIssueCode(code)
}

function runRepairItem(run: RepairExecutionRunEntry, issue: RepairExecutionIssue): PrerequisiteIssue {
  return repairItem({
    id: `attempt:${run.runId}:${issue.code}`,
    area: 'attempt_recovery',
    severity: 'attention',
    title: executionIssueLabel(issue.code),
    reason: ISSUE_REASON[issue.code] ?? 'This attempt recorded inconsistent execution state.',
    suggestedAction: ISSUE_ACTION[issue.code] ?? 'Open the attempt and reconcile its execution evidence.',
    record: recordRef('Attempt', run.runId),
    field: { path: `attempts.${run.runId}.evidence`, label: ISSUE_FIELD[issue.code] ?? 'execution evidence' },
    status: 'unknown',
    issueCode: issue.code,
    target: { projectName: run.projectName, specName: run.specName, taskId: run.taskId, taskName: run.taskName, attemptId: run.runId },
    href: recordHref(run.projectName, run.specName, run.taskName, run.runId),
    linkLabel: 'Open attempt',
  })
}

function taskRepairItem(task: RepairExecutionTaskEntry, issue: RepairExecutionIssue): PrerequisiteIssue {
  return repairItem({
    id: `task:${task.taskId}:${issue.code}`,
    area: 'attempt_recovery',
    severity: 'attention',
    title: executionIssueLabel(issue.code),
    reason: ISSUE_REASON[issue.code] ?? 'This task recorded inconsistent execution state.',
    suggestedAction: ISSUE_ACTION[issue.code] ?? 'Open the task and reconcile its execution evidence.',
    record: recordRef('Task', task.taskId, task.taskName),
    field: { path: `tasks.${task.taskId}.evidence`, label: ISSUE_FIELD[issue.code] ?? 'execution evidence' },
    status: 'unknown',
    issueCode: issue.code,
    target: { projectName: task.projectName, specId: task.specId, specName: task.specName, taskId: task.taskId, taskName: task.taskName },
    href: recordHref(task.projectName, task.specName, task.taskName, null),
    linkLabel: 'Open task',
  })
}

function recordHref(project: string, spec: string, task: string, runId: string | null): string {
  const base = `/${enc(project)}/${enc(spec)}/${enc(task)}`
  return runId == null ? base : `${base}/${enc(shortId(runId))}`
}

function shortId(id: string): string {
  return id.slice(0, 6)
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

function humanizeIssueCode(code: string): string {
  const words = code.split(/[_\s-]+/).filter(Boolean)
  if (words.length === 0) return 'Execution integrity issue'
  return words.map((word, index) => index === 0 ? capitalize(word) : word).join(' ')
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`
}
