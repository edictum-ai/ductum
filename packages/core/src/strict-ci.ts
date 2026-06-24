import type { CICheckResult } from './watcher.js'

export type StrictCiClassification = 'pending' | 'pass' | 'fail'

type StrictCiCheck = Pick<CICheckResult, 'status' | 'conclusion'>

export function classifyCiChecks(checks: readonly unknown[] | null | undefined): StrictCiClassification {
  if (!Array.isArray(checks) || checks.length === 0) return 'pending'

  let pending = false
  for (const check of checks) {
    if (!isStrictCiCheck(check)) return 'fail'
    if (check.status !== 'completed') {
      pending = true
      continue
    }
    if (check.conclusion !== 'success') return 'fail'
  }

  return pending ? 'pending' : 'pass'
}

export function ciEvidenceHasStrictPass(payload: Record<string, unknown>): boolean {
  return classifyCiChecks(Array.isArray(payload.checks) ? payload.checks : undefined) === 'pass'
}

function isStrictCiCheck(check: unknown): check is StrictCiCheck {
  if (typeof check !== 'object' || check == null) return false
  const fields = check as { status?: unknown; conclusion?: unknown }
  return isStrictCiStatus(fields.status) && isStrictCiConclusion(fields.conclusion)
}

function isStrictCiStatus(value: unknown): value is StrictCiCheck['status'] {
  return value === 'queued' || value === 'in_progress' || value === 'completed'
}

function isStrictCiConclusion(value: unknown): value is StrictCiCheck['conclusion'] {
  return value === null
    || value === 'success'
    || value === 'failure'
    || value === 'neutral'
    || value === 'skipped'
    || value === 'timed_out'
}
