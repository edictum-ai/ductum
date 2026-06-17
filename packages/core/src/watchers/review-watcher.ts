import type { ReviewResult, WatcherConfig, WatcherDependencies, WatcherOptions } from '../watcher.js'
import { buildGithubReviewQueryArgs, parseGithubReviewPayload } from './review-watcher-helpers.js'
import { BaseWatcher } from './base.js'

export class ReviewWatcher extends BaseWatcher {
  constructor(config: WatcherConfig, deps: WatcherDependencies, options: WatcherOptions = {}) {
    super(config, deps, options)
  }

  protected async pollOnce(): Promise<boolean> {
    const review = await this.fetchReview()
    if (review == null) {
      return false
    }
    await this.resolve(review.status === 'approved', review)
    return true
  }

  protected async resolveTimeout(): Promise<void> {
    const parent = this.validateParent('review')
    if (!('run' in parent)) {
      this.finalize(parent.reason)
      return
    }
    this.deps.runRepo.updateLatchStatus(parent.run.id, 'reviewStatus', 'fail')
    this.attachEvidence('review', {
      passed: false,
      reason: 'Review timed out',
      commitSha: this.config.commitSha,
      resolvedAt: this.resolvedAt(),
    })
    this.finalize('Review timed out')
    await this.deps.onWatcherResolved?.(parent.run.id, 'review', false)
  }

  private async fetchReview(): Promise<ReviewResult | null> {
    const output = await this.runCommand(buildGithubReviewQueryArgs(this.config.prUrl))
    return parseGithubReviewPayload(JSON.parse(output))
  }

  private async resolve(passed: boolean, review: ReviewResult): Promise<void> {
    const parent = this.validateParent('review')
    if (!('run' in parent)) {
      this.finalize(parent.reason)
      return
    }
    this.deps.runRepo.updateLatchStatus(parent.run.id, 'reviewStatus', passed ? 'pass' : 'fail')
    this.attachEvidence('review', {
      passed,
      review,
      commitSha: this.config.commitSha,
      resolvedAt: this.resolvedAt(),
    })
    const reason =
      passed
        ? 'Review approved'
        : review.status === 'commented'
          ? 'Review warning findings remain'
          : 'Review changes requested'
    this.finalize(reason)
    await this.deps.onWatcherResolved?.(parent.run.id, 'review', passed)
  }
}
