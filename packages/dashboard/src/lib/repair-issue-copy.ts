/**
 * Operator-facing copy for core execution-integrity issue codes. Kept apart
 * from the repair builder so the (necessarily wordy) plain-language reason /
 * action / field strings do not push the builder over the file-size gate.
 *
 * All copy uses redesigned vocabulary — "attempt", never "run".
 */

const ISSUE_REASON: Record<string, string> = {
  done_run_without_lineage_or_external_outcome:
    'This attempt is marked done, but Ductum has no session, worktree, or commit for it and no recorded external outcome, so the completion is not traceable.',
  done_task_without_lineage_or_external_outcome:
    'This task is marked done, but no attempt carries Ductum lineage (session, worktree, commit) and no external outcome is recorded.',
  external_outcome_on_non_done_run:
    'An external outcome was recorded on an attempt that has not finished. Outcomes only apply once the attempt is done.',
  final_evidence_on_non_done_run:
    'This attempt carries structured final verification or review evidence but is not marked done.',
  prose_success_signal_on_non_done_run:
    'This attempt has notes that read like success but it is not done. Prose is not completion evidence.',
  invalid_external_outcome:
    'The external outcome recorded on this attempt is not one of the accepted values (done, fixed, superseded).',
  invalid_bakeoff_candidate_outcome:
    'The bakeoff outcome recorded on this attempt is not an accepted value (accepted, accepted-with-fixes, rejected, fixed, superseded).',
  linked_commit_without_lineage:
    'This attempt references a commit but has no Ductum session or worktree lineage and no external outcome to back it.',
  bakeoff_candidate_without_outcome:
    'This bakeoff candidate finished without an explicit accept, reject, or fix decision.',
}

const ISSUE_ACTION: Record<string, string> = {
  done_run_without_lineage_or_external_outcome:
    'Open the attempt and record an external outcome, or start a new attempt so it carries real execution lineage.',
  done_task_without_lineage_or_external_outcome:
    'Open the task and record an external outcome, or start a new attempt so it carries Ductum lineage.',
  external_outcome_on_non_done_run:
    'Finish or close the attempt, or remove the premature external outcome.',
  final_evidence_on_non_done_run:
    'Advance the attempt to done, or re-check why it stopped before completion.',
  prose_success_signal_on_non_done_run:
    'Confirm the real status and advance or close the attempt; do not treat prose as a passing result.',
  invalid_external_outcome:
    'Re-record the external outcome using one of the accepted values.',
  invalid_bakeoff_candidate_outcome:
    'Re-record the bakeoff outcome using one of the accepted values.',
  linked_commit_without_lineage:
    'Record an external outcome or start a new attempt so the commit ties to traceable execution.',
  bakeoff_candidate_without_outcome:
    'Open the task and record the bakeoff decision.',
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

export interface IssueCopy {
  reason: string
  action: string
  field: string | null
}

export function issueCopy(code: string, scope: 'attempt' | 'task'): IssueCopy {
  return {
    reason: ISSUE_REASON[code] ?? `This ${scope} recorded inconsistent execution state and needs reconciliation.`,
    action: ISSUE_ACTION[code] ?? `Open the ${scope} and reconcile its execution evidence.`,
    field: ISSUE_FIELD[code] ?? null,
  }
}
