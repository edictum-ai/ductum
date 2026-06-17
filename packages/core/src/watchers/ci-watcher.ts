import type { CICheckResult, WatcherConfig, WatcherDependencies, WatcherOptions } from '../watcher.js'
import { BaseWatcher } from './base.js'

interface RawCheck {
  name?: string
  state?: string | null
  conclusion?: string | null
}

export class CIWatcher extends BaseWatcher {
  constructor(config: WatcherConfig, deps: WatcherDependencies, options: WatcherOptions = {}) {
    super(config, deps, options)
  }

  protected async pollOnce(): Promise<boolean> {
    const checks = await this.fetchChecks()
    if (checks.length === 0 || checks.some((check) => check.status !== 'completed')) {
      return false
    }
    const passed = checks.every((check) =>
      ['success', 'neutral', 'skipped'].includes(check.conclusion ?? ''),
    )
    await this.resolve(passed, checks)
    return true
  }

  protected async resolveTimeout(): Promise<void> {
    const parent = this.validateParent('ci')
    if (!('run' in parent)) {
      this.finalize(parent.reason)
      return
    }
    this.deps.runRepo.updateLatchStatus(parent.run.id, 'ciStatus', 'fail')
    this.attachEvidence('ci', {
      passed: false,
      reason: 'CI timed out',
      commitSha: this.config.commitSha,
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
      'name,state,conclusion',
    ])
    return (JSON.parse(output) as RawCheck[]).map((check) => ({
      name: check.name ?? 'unknown',
      status: normalizeStatus(check.state),
      conclusion: normalizeConclusion(check.conclusion),
    }))
  }

  private async resolve(passed: boolean, checks: CICheckResult[]): Promise<void> {
    const parent = this.validateParent('ci')
    if (!('run' in parent)) {
      this.finalize(parent.reason)
      return
    }
    this.deps.runRepo.updateLatchStatus(parent.run.id, 'ciStatus', passed ? 'pass' : 'fail')
    this.attachEvidence('ci', {
      passed,
      checks,
      commitSha: this.config.commitSha,
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
  return 'completed'
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
