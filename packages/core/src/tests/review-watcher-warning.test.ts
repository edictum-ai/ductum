import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewWatcher } from '../watchers/review-watcher.js'
import { createCommandRunner, createWatcherFixture, flushWatchers } from './watcher-fixture.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  for (const fixture of cleanup.splice(0)) {
    fixture.context.db.close()
  }
})

describe('ReviewWatcher warning semantics', () => {
  it('treats commented reviews as warning findings instead of leaving the PR pending', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const runner = createCommandRunner({
      reviews: [
        JSON.stringify({
          reviewDecision: null,
          latestReviews: [
            {
              author: { login: 'codex' },
              state: 'COMMENTED',
              body: 'rename this helper',
              submittedAt: '2026-04-04T10:03:00Z',
            },
          ],
        }),
      ],
    })
    const onResolved = vi.fn(async () => {})
    const watcher = new ReviewWatcher(
      { type: 'review', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter, onWatcherResolved: onResolved },
      { commandRunner: runner.runner },
    )

    watcher.start()
    await flushWatchers()

    await vi.waitFor(() => {
      expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
        passed: false,
        review: {
          status: 'commented',
          findings: ['codex: rename this helper'],
        },
      })
      expect(onResolved).toHaveBeenCalledWith(fixture.run.id, 'review', false)
    })
  })

  it('does not mark approved clean while unresolved warning threads remain', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const runner = createCommandRunner({
      reviews: [
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewDecision: 'APPROVED',
                latestReviews: {
                  nodes: [
                    {
                      author: { login: 'codex' },
                      state: 'APPROVED',
                      body: '',
                      submittedAt: '2026-04-04T10:04:00Z',
                    },
                  ],
                },
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      isOutdated: false,
                      path: 'packages/core/src/review.ts',
                      line: 12,
                      comments: {
                        nodes: [
                          {
                            author: { login: 'review-bot' },
                            body: 'missing null guard',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      ],
    })
    const onResolved = vi.fn(async () => {})
    const watcher = new ReviewWatcher(
      { type: 'review', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter, onWatcherResolved: onResolved },
      { commandRunner: runner.runner },
    )

    watcher.start()
    await flushWatchers()

    await vi.waitFor(() => {
      expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
        passed: false,
        review: {
          status: 'commented',
          findings: ['packages/core/src/review.ts:12 - review-bot: missing null guard'],
        },
      })
      expect(onResolved).toHaveBeenCalledWith(fixture.run.id, 'review', false)
    })
  })
})
