import type { Evidence, Run, Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { malformedReviewState } from '../lib/bakeoff-compare-malformed.js'

describe('malformedReviewState', () => {
  it('counts a malformed review run once when both failReason and evidence mark it malformed', () => {
    const task = { id: 'review-task' } as Task
    const run = {
      id: 'review-run-1',
      failReason: 'Malformed reviewer completion: empty result',
    } as Run
    const evidence = [{
      payload: {
        kind: 'internal-review',
        malformed: true,
        feedback: 'Malformed reviewer completion: empty result',
      },
    }] as unknown as Evidence[]

    expect(malformedReviewState(
      task,
      () => [run],
      () => evidence,
    )).toEqual({
      reviewCount: 1,
      recoveryState: 'Malformed reviewer completion: empty result',
    })
  })

  it('recognizes lowercase persisted malformed reasons', () => {
    const task = { id: 'review-task' } as Task
    const run = {
      id: 'review-run-1',
      failReason: 'malformed reviewer completion',
    } as Run

    expect(malformedReviewState(
      task,
      () => [run],
      () => [],
    )).toMatchObject({ reviewCount: 1 })
  })

  it('counts persisted malformed review evidence without a matching fail reason', () => {
    const task = { id: 'review-task' } as Task
    const run = { id: 'review-run-1', failReason: null } as Run
    const evidence = [{
      payload: {
        kind: 'internal-review',
        malformed: true,
        feedback: 'Malformed reviewer completion: requires exactly one structured contract',
      },
    }] as unknown as Evidence[]

    expect(malformedReviewState(
      task,
      () => [run],
      () => evidence,
    )).toEqual({
      reviewCount: 1,
      recoveryState: 'Malformed reviewer completion: requires exactly one structured contract',
    })
  })

  it('recognizes malformed blind-review winner resolution reasons', () => {
    const task = { id: 'review-task' } as Task
    const run = {
      id: 'review-run-1',
      failReason: 'blind review completion is malformed; structured verdict evidence cannot override a missing ductum-review-result contract',
    } as Run

    expect(malformedReviewState(
      task,
      () => [run],
      () => [],
    )).toMatchObject({ reviewCount: 1 })
  })
})
