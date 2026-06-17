import type { ProjectRepo, RunRepo, SpecRepo, TaskRepo } from './repos/interfaces.js'
import type { Run } from './types.js'

export interface ExternalReviewRepos {
  projectRepo: ProjectRepo
  runRepo: RunRepo
  specRepo: SpecRepo
  taskRepo: TaskRepo
}

export interface DerivedShipState {
  blockedReason: string | null
  pendingApproval: boolean
  externalReviewRequired: boolean
}

export function isExternalReviewRequired(
  repos: Omit<ExternalReviewRepos, 'runRepo'>,
  run: Pick<Run, 'taskId'>,
): boolean {
  const task = repos.taskRepo.get(run.taskId)
  if (task == null) return false
  const spec = repos.specRepo.get(task.specId)
  if (spec == null) return false
  const project = repos.projectRepo.get(spec.projectId)
  return project?.config.externalReviewRequired === true
}

export function deriveShipState(
  repos: ExternalReviewRepos,
  runId: Run['id'],
  base: { blockedReason: string | null; pendingApproval: boolean },
): DerivedShipState {
  const run = repos.runRepo.get(runId)
  if (run == null) {
    return {
      blockedReason: base.blockedReason,
      pendingApproval: base.pendingApproval,
      externalReviewRequired: false,
    }
  }

  const externalReviewRequired = isExternalReviewRequired(repos, run)
  if (!externalReviewRequired || run.stage !== 'ship') {
    return {
      blockedReason: base.blockedReason,
      pendingApproval: base.pendingApproval,
      externalReviewRequired,
    }
  }

  const missing = missingLinkFields(run)
  if (missing.length > 0) {
    return {
      blockedReason: `External PR review required before ship: missing ${joinWithAnd(missing)}.`,
      pendingApproval: false,
      externalReviewRequired,
    }
  }

  const failed = failedChecks(run)
  if (failed.length > 0) {
    return {
      blockedReason: `External PR review failed: ${joinWithAnd(failed)}.`,
      pendingApproval: false,
      externalReviewRequired,
    }
  }

  const waiting = waitingChecks(run)
  if (waiting.length > 0) {
    return {
      blockedReason: `External PR review required before ship: waiting for ${joinWithAnd(waiting)}.`,
      pendingApproval: false,
      externalReviewRequired,
    }
  }

  return {
    blockedReason: base.blockedReason,
    pendingApproval: base.pendingApproval,
    externalReviewRequired,
  }
}

function missingLinkFields(run: Pick<Run, 'branch' | 'commitSha' | 'prUrl'>): string[] {
  const missing: string[] = []
  if (isBlank(run.branch)) missing.push('branch')
  if (isBlank(run.commitSha)) missing.push('commitSha')
  if (isBlank(run.prUrl)) missing.push('prUrl')
  return missing
}

function failedChecks(run: Pick<Run, 'ciStatus' | 'reviewStatus'>): string[] {
  const failed: string[] = []
  if (run.ciStatus === 'fail') failed.push('external CI')
  if (run.reviewStatus === 'fail') failed.push('external GitHub review')
  return failed
}

function waitingChecks(run: Pick<Run, 'ciStatus' | 'reviewStatus'>): string[] {
  const waiting: string[] = []
  if (run.ciStatus !== 'pass') waiting.push('external CI')
  if (run.reviewStatus !== 'pass') waiting.push('external GitHub review')
  return waiting
}

function isBlank(value: string | null): boolean {
  return value == null || value.trim() === ''
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}
