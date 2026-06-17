/**
 * Task kind classification — mirrors `parseTaskName` in @ductum/core's
 * post-completion-router, but lives in the dashboard package so the
 * UI can drive visual hierarchy without importing from the server.
 *
 * Why this exists: the factory's fix-loop creates review-* and fix-*
 * tasks under the same spec as the original impl task. Without
 * clearly labeling them by ROLE (builder work vs reviewer critique
 * vs remediation) the dashboard renders them all as undifferentiated
 * rows, which hides the intent of each task from the operator. This
 * helper gives every consumer a single vocabulary for:
 *
 *   - kind: which flow the task is part of (impl / review / fix)
 *   - role: the human-readable role the task plays
 *   - round: which round of the loop (0 for impl)
 *   - originalName: the lineage root name
 *
 * Strings are stable — safe to switch-case on.
 */

export type TaskKind = 'impl' | 'review' | 'fix'

export interface ParsedTaskKind {
  /** 'impl' | 'review' | 'fix' — stable for switch-case. */
  kind: TaskKind
  /** Lineage root: the impl task name all reviews/fixes hang off of. */
  originalName: string
  /** 0 for impl; 1+ for review/fix rounds. */
  round: number
  /** Human-readable role label shown in the UI. */
  roleLabel: string
  /** Short role code for badges / compact rows. */
  roleCode: string
}

type TaskKindInput = {
  name?: string | null
  requiredRole?: string | null
}

/**
 * Parse a task name into its lineage kind. Mirrors the parse logic
 * in @ductum/core post-completion-router.
 *
 *   `P1`              → impl,  round 0
 *   `review-P1`       → review, round 1
 *   `review-P1-r2`    → review, round 2
 *   `fix-P1-r1`       → fix,   round 1
 */
export function parseTaskKind(name: string): ParsedTaskKind {
  const reviewRoundMatch = name.match(/^review-(.+)-r(\d+)$/)
  if (reviewRoundMatch != null) {
    const round = Number(reviewRoundMatch[2])
    return {
      kind: 'review',
      originalName: reviewRoundMatch[1]!,
      round,
      roleLabel: `Review round ${round}`,
      roleCode: `R${round}`,
    }
  }
  if (name.startsWith('review-')) {
    return {
      kind: 'review',
      originalName: name.slice('review-'.length),
      round: 1,
      roleLabel: 'Review',
      roleCode: 'R1',
    }
  }
  const fixMatch = name.match(/^fix-(.+)-r(\d+)$/)
  if (fixMatch != null) {
    const round = Number(fixMatch[2])
    return {
      kind: 'fix',
      originalName: fixMatch[1]!,
      round,
      roleLabel: `Fix round ${round}`,
      roleCode: `F${round}`,
    }
  }
  return {
    kind: 'impl',
    originalName: name,
    round: 0,
    roleLabel: 'Implementation',
    roleCode: 'IMPL',
  }
}

export function classifyTaskKind(task: TaskKindInput): ParsedTaskKind {
  const name = task.name ?? ''
  if (name === '') {
    return {
      kind: 'impl',
      originalName: '',
      round: 0,
      roleLabel: 'Implementation',
      roleCode: 'IMPL',
    }
  }
  const parsed = parseTaskKind(name)
  if (parsed.kind === 'review' && task.requiredRole === 'reviewer') return parsed
  if (parsed.kind === 'fix' && task.requiredRole === 'builder') return parsed
  return {
    kind: 'impl',
    originalName: name,
    round: 0,
    roleLabel: 'Implementation',
    roleCode: 'IMPL',
  }
}

/** Tailwind classes for the badge that marks each task kind. */
export const TASK_KIND_BADGE_CLASSES: Record<TaskKind, string> = {
  impl: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  review: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  fix: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
}

/** Tailwind border color for the lineage bracket/indent line. */
export const TASK_KIND_ACCENT_BORDER: Record<TaskKind, string> = {
  impl: 'border-l-blue-500/50',
  review: 'border-l-purple-500/40',
  fix: 'border-l-amber-500/40',
}

/** Short one-line description used in tooltips and DAG hover. */
export const TASK_KIND_DESCRIPTION: Record<TaskKind, string> = {
  impl: 'Main implementation task — the builder agent writes code here',
  review: 'Automated code review — a different agent checks the diff',
  fix: 'Remediation round — addresses findings from a previous review',
}
