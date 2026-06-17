import type { ExecutionIssue, ExecutionMode } from '@/api/client'

export const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  orchestrated: 'Ductum',
  external: 'External',
  recorded: 'Recorded',
  unknown: 'Unknown',
  inconsistent: 'Inconsistent',
}

export function hasExecutionIntegrityIssue(
  item: { executionMode?: ExecutionMode; executionIssues?: ExecutionIssue[] },
): boolean {
  return item.executionMode === 'inconsistent' || (item.executionIssues?.length ?? 0) > 0
}

export function executionModeLabel(mode: ExecutionMode): string {
  return EXECUTION_MODE_LABEL[mode]
}

/**
 * Human label for a core execution-integrity issue code. Normal UI must
 * not show the raw enum (e.g. `done_task_without_lineage_or_external_outcome`)
 * as the primary label (P7C / redesign forbidden-word rules). The raw code
 * stays available as secondary/debug metadata. Unknown codes fall back to a
 * humanized form so a new core code never surfaces as a bare snake_case enum.
 */
export const EXECUTION_ISSUE_LABEL: Record<string, string> = {
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

export function executionIssueLabel(code: string): string {
  return EXECUTION_ISSUE_LABEL[code] ?? humanizeIssueCode(code)
}

function humanizeIssueCode(code: string): string {
  const words = code.split(/[_\s-]+/).filter(Boolean)
  if (words.length === 0) return 'Execution integrity issue'
  return words
    .map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

export function executionModeBadgeLabel(
  item: { executionMode?: ExecutionMode; executionIssues?: ExecutionIssue[] },
): string | null {
  const mode = item.executionMode
  if (mode == null) return null
  const issues = item.executionIssues?.length ?? 0
  return issues > 0
    ? `${executionModeLabel(mode)}: ${issues} issue${issues === 1 ? '' : 's'}`
    : executionModeLabel(mode)
}
