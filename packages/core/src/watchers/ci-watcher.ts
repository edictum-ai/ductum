import type { CICheckResult, WatcherConfig, WatcherDependencies, WatcherOptions } from '../watcher.js'
import { classifyCiChecks } from '../strict-ci.js'
import { BaseWatcher } from './base.js'

interface RawCheck {
  bucket?: string | null
  name?: string
  state?: string | null
  conclusion?: string | null
}

interface RawPullRequestView {
  headRefOid?: string | null
}

export class CIWatcher extends BaseWatcher {
  constructor(config: WatcherConfig, deps: WatcherDependencies, options: WatcherOptions = {}) {
    super(config, deps, options)
  }

  protected async pollOnce(): Promise<boolean> {
    const checks = await this.fetchChecks()
    const classification = classifyCiChecks(checks)
    if (classification === 'pending') return false
    const passed = classification === 'pass'
    await this.resolve(passed, checks)
    return true
  }

  protected async resolveTimeout(): Promise<void> {
    const checkedCommitSha = await this.fetchCurrentHeadSha()
    const parent = this.validateParent('ci', checkedCommitSha)
    if (!('run' in parent)) {
      this.finalize(parent.reason)
      return
    }
    if (parent.run.commitSha !== checkedCommitSha) {
      this.deps.runRepo.updateGitArtifacts(parent.run.id, { commitSha: checkedCommitSha })
    }
    this.deps.runRepo.updateLatchStatus(parent.run.id, 'ciStatus', 'fail')
    this.attachEvidence('ci', {
      passed: false,
      reason: 'CI timed out',
      commitSha: checkedCommitSha,
      resolvedAt: this.resolvedAt(),
    })
    this.finalize('CI timed out')
    await this.deps.onWatcherResolved?.(parent.run.id, 'ci', false)
  }

  private async fetchChecks(): Promise<CICheckResult[]> {
    const output = await this.runCommand([
      'pr',
      'checks',
      this.config.prUrl,
      '--json',
      'name,state,bucket',
    ])
    return (JSON.parse(output) as RawCheck[]).map((check) => ({
      name: check.name ?? 'unknown',
      status: normalizeStatus(check.state),
      conclusion: normalizeConclusion(check.conclusion ?? conclusionFromBucket(check.bucket)),
    }))
  }

  private async fetchCurrentHeadSha(): Promise<string> {
    const output = await this.runCommand(['pr', 'view', this.config.prUrl, '--json', 'headRefOid'])
    const headSha = (JSON.parse(output) as RawPullRequestView).headRefOid?.trim()
    return headSha == null || headSha === '' ? this.config.commitSha : headSha
  }

  private async resolve(passed: boolean, checks: CICheckResult[]): Promise<void> {
    const checkedCommitSha = await this.fetchCurrentHeadSha()
    const parent = this.validateParent('ci', checkedCommitSha)
    if (!('run' in parent)) {
      this.finalize(parent.reason)
      return
    }
    if (parent.run.commitSha !== checkedCommitSha) {
      this.deps.runRepo.updateGitArtifacts(parent.run.id, { commitSha: checkedCommitSha })
    }
    this.deps.runRepo.updateLatchStatus(parent.run.id, 'ciStatus', passed ? 'pass' : 'fail')
    this.attachEvidence('ci', {
      passed,
      checks,
      commitSha: checkedCommitSha,
      resolvedAt: this.resolvedAt(),
    })
    this.finalize(passed ? 'CI passed' : 'CI failed')
    await this.deps.onWatcherResolved?.(parent.run.id, 'ci', passed)
  }
}

function normalizeStatus(state: string | null | undefined): CICheckResult['status'] {
  const value = (state ?? '').toLowerCase()
  if (value === 'queued' || value === 'pending' || value === 'requested') {
    return 'queued'
  }
  if (value === 'in_progress') {
    return 'in_progress'
  }
  if (
    value === 'completed'
    || value === 'success'
    || value === 'failure'
    || value === 'neutral'
    || value === 'skipped'
    || value === 'timed_out'
    || value === 'cancelled'
  ) {
    return 'completed'
  }
  return 'queued'
}

function conclusionFromBucket(bucket: string | null | undefined): string | null | undefined {
  const value = bucket == null ? null : bucket.toLowerCase()
  if (value === 'pass') return 'success'
  if (value === 'fail') return 'failure'
  if (value === 'skipping') return 'skipped'
  if (value === 'pending') return null
  return undefined
}

function normalizeConclusion(
  conclusion: string | null | undefined,
): CICheckResult['conclusion'] {
  const value = conclusion == null ? null : conclusion.toLowerCase()
  if (value == null || value === 'success' || value === 'failure') {
    return value
  }
  if (value === 'neutral' || value === 'skipped' || value === 'timed_out') {
    return value
  }
  return 'failure'
}
