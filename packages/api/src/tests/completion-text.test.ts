import type { RunActivity, RunId, RunUpdate } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { resolveReviewCompletionText } from '../lib/completion-text.js'

const runId = 'run-1' as RunId

function activity(overrides: Partial<RunActivity>): RunActivity {
  return {
    id: overrides.id ?? 1,
    runId,
    kind: overrides.kind ?? 'tool_call',
    content: overrides.content ?? '{}',
    toolName: overrides.toolName ?? 'ductum.complete',
    createdAt: overrides.createdAt ?? '2026-04-25T00:00:00Z',
  }
}

function update(message: string, id = 1): RunUpdate {
  return {
    id,
    runId,
    message,
    createdAt: `2026-04-25T00:00:0${id}Z`,
  }
}

describe('resolveReviewCompletionText', () => {
  it('prefers the persisted run completion summary over activity scraping', () => {
    expect(resolveReviewCompletionText([
      activity({ content: '{}' }),
    ], [update('PASS: stale progress')], 'FAIL: persisted completion text')).toBe('FAIL: persisted completion text')
  })

  it('prefers the explicit completion tool result text', () => {
    expect(resolveReviewCompletionText([
      activity({ kind: 'tool_result', content: '{"stage":"implement"}' }),
      activity({ content: '{"result":"FAIL: still broken"}' }),
    ], [update('PASS: stale progress')])).toBe('FAIL: still broken')
  })

  it('keeps malformed explicit completion text instead of hiding it behind an update', () => {
    expect(resolveReviewCompletionText([
      activity({ content: '{"result":"looks fine"}' }),
    ], [update('FAIL: stale progress')])).toBe('looks fine')
  })

  it('salvages structured review JSON from completion activity when the explicit tool result is empty', () => {
    const reviewJson = JSON.stringify({
      kind: 'ductum-review-result',
      verdict: 'pass',
      summary: 'ready to ship',
      findings: [],
    })

    expect(resolveReviewCompletionText([
      activity({ content: '{}' }),
      activity({ id: 2, kind: 'result', toolName: null, content: reviewJson }),
    ], [])).toBe(reviewJson)
  })

  it('preserves multiple structured review contracts from activity evidence instead of guessing', () => {
    const first = JSON.stringify({
      kind: 'ductum-review-result',
      verdict: 'pass',
      summary: 'candidate A',
      findings: [],
    })
    const second = JSON.stringify({
      kind: 'ductum-review-result',
      verdict: 'fail',
      summary: 'candidate B',
      findings: ['regression'],
    })

    expect(resolveReviewCompletionText([
      activity({ content: '{}' }),
      activity({ id: 2, kind: 'result', toolName: null, content: first }),
      activity({ id: 3, kind: 'summary', toolName: null, content: second }),
    ], [])).toBe([first, second].join('\n\n'))
  })

  it('falls back to the latest explicit verdict update when complete args are empty', () => {
    expect(resolveReviewCompletionText([
      activity({ content: '{}' }),
    ], [
      update('Working through the review', 1),
      update('WARN: add focused reject failure tests', 2),
    ])).toBe('WARN: add focused reject failure tests')
  })

  it('returns null when neither complete args nor progress updates contain a verdict', () => {
    expect(resolveReviewCompletionText([
      activity({ content: '{}' }),
    ], [update('review finished')])).toBeNull()
  })
})
