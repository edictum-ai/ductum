import { describe, expect, it } from 'vitest'

import { parseReviewResult } from '../post-completion.js'

/**
 * Decision 123 (P3.3): leading-verdict acceptance path.
 *
 * The strict-terminal parser shipped under D060 rejected every
 * reviewer that opened with a verdict line and then explained itself
 * in trailing prose — Codex always does that, P19 needed three retries
 * before any verdict landed. This test file pins the new path:
 *
 *   - the FIRST non-empty line of the completion is checked for a
 *     verdict shape (`PASS` / `PASS: ...` / `WARN: ...` / `FAIL: ...`)
 *   - if it matches, the remaining lines are scanned for any other
 *     verdict-shaped line. If a later line carries a DIFFERENT verdict
 *     word, the parse is rejected as malformed (the downgrade attack).
 *   - the section-anchored path (D116) and the strict-terminal path
 *     (D060) still take priority when they match.
 *
 * The fixtures here include the shapes we collected from the four
 * reviewer agents on 2026-04-30 plus the synthetic adversarial cases
 * the Slop Review demanded.
 */
describe('parseReviewResult leading-verdict path (Decision 123)', () => {
  it('accepts a Codex-style PASS where the verdict opens the completion and prose follows', () => {
    const codexCompletion = [
      'PASS: implementation matches the task and verify is green.',
      '',
      'Detailed review:',
      '- The new helper is named appropriately and is tested.',
      '- Diff is small and focused on the requested behavior.',
      '- No obvious null-handling or async issues.',
    ].join('\n')

    const result = parseReviewResult(codexCompletion)

    expect(result.verdict).toBe('pass')
    expect(result.passed).toBe(true)
    expect(result.malformed).toBeFalsy()
    expect(result.feedback).toContain('verify is green')
    expect(result.feedback).toContain('Detailed review')
  })

  it('accepts a Codex-style FAIL where the verdict opens and findings follow', () => {
    const codexCompletion = [
      'FAIL: missing null guard on the new helper.',
      '',
      'Findings:',
      '1. `parseReviewResult` panics on undefined input.',
      '2. The terminal-line fallback regex is anchored too loosely.',
    ].join('\n')

    const result = parseReviewResult(codexCompletion)

    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
    expect(result.malformed).toBeFalsy()
    expect(result.feedback).toContain('missing null guard')
    expect(result.feedback).toContain('Findings:')
  })

  it('accepts a Codex-style WARN where cleanup notes follow the verdict', () => {
    const codexCompletion = [
      'WARN: rename the new helper for clarity.',
      '',
      'The implementation is correct, but `doThing()` is a poor name.',
    ].join('\n')

    const result = parseReviewResult(codexCompletion)

    expect(result.verdict).toBe('warn')
    expect(result.passed).toBe(false)
    expect(result.malformed).toBeFalsy()
    expect(result.feedback).toContain('rename the new helper')
    expect(result.feedback).toContain('poor name')
  })

  it('accepts a leading bare PASS with trailing reasoning', () => {
    const completion = [
      'PASS',
      '',
      'No findings.',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('pass')
    expect(result.passed).toBe(true)
    expect(result.malformed).toBeFalsy()
  })

  it('accepts a leading verdict that mentions PASS / WARN / FAIL inside trailing prose without conflict', () => {
    // The trailing prose mentions "PASS" inside a sentence, not as a
    // standalone verdict-shaped line. Should not trigger downgrade
    // detection — only standalone verdict-shaped lines count.
    const completion = [
      'PASS: looks good.',
      '',
      'I considered marking this as a soft PASS but decided against it.',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('pass')
    expect(result.passed).toBe(true)
    expect(result.malformed).toBeFalsy()
  })

  it('lets the strict-terminal path win when both leading and trailing verdict lines disagree', () => {
    // When the reviewer leads with PASS and ends with an explicit FAIL
    // line, the strict-terminal path (D060, priority 2) takes the
    // trailing verdict as the operator's actual final answer. This is
    // the right call: the reviewer typed FAIL last, on purpose. The
    // leading-verdict path only kicks in when there's no terminal
    // verdict to anchor on.
    const completion = [
      'PASS: at first glance the diff looks right.',
      '',
      'On closer inspection:',
      'FAIL: the null guard at line 42 is missing.',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
    expect(result.malformed).toBeFalsy()
  })

  it('rejects a leading verdict when a later verdict-shaped line disagrees and there is no clean terminal verdict', () => {
    // The actual downgrade-attack vector: leading verdict, conflicting
    // intermediate verdict-shaped line, prose terminal. Neither the
    // section anchor nor the strict-terminal path matches, so the
    // leading-verdict path runs — and refuses because the conflict
    // exists. The review is re-dispatched.
    const completion = [
      'PASS: looks good at first glance.',
      '',
      'But on careful inspection:',
      'FAIL: the null guard at line 42 is missing.',
      '',
      'I will leave the final call to the next reviewer in the chain.',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.malformed).toBe(true)
    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
  })

  it('section-anchored path still wins when the heading is present', () => {
    // D116 takes priority over the leading-verdict path. A reviewer
    // who emits the heading gets the strict section-anchor parse, even
    // if their first non-empty line happened to be verdict-shaped.
    const completion = [
      'WARN: leading hint — please consult the section below.',
      '',
      '## Final verdict',
      '',
      'PASS: ready to ship',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('pass')
    expect(result.passed).toBe(true)
    expect(result.malformed).toBeFalsy()
  })

  it('strict-terminal path still wins when the LAST line is verdict-shaped', () => {
    // D060 stays as the priority-2 path. A reviewer that opens with
    // verdict-shaped prose AND closes with a clean verdict line gets
    // the closing verdict, not the opening one.
    const completion = [
      'WARN: opening note about cleanup.',
      '',
      'After review I am satisfied.',
      'PASS: ready to ship',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('pass')
    expect(result.passed).toBe(true)
    expect(result.malformed).toBeFalsy()
  })

  it('still rejects mid-prose verdict mentions without any anchor', () => {
    // Without leading, terminal, or section anchor, a mid-prose verdict
    // mention stays malformed. This is the regression guard that
    // protects D060's original safety property.
    const completion = [
      'I reviewed the diff and have a few thoughts.',
      'Overall I think this is a PASS in spirit, but I am not sure.',
      'Some prose continues here without ever ending in a verdict line.',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.malformed).toBe(true)
    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
  })

  it('accepts a single leading verdict line by itself', () => {
    expect(parseReviewResult('PASS: looks good')).toMatchObject({
      verdict: 'pass',
      passed: true,
    })
    expect(parseReviewResult('WARN: rename the helper')).toMatchObject({
      verdict: 'warn',
      passed: false,
    })
    expect(parseReviewResult('FAIL: still broken')).toMatchObject({
      verdict: 'fail',
      passed: false,
    })
  })

  it('preserves the leading verdict tail and trailing prose as feedback', () => {
    // Operators reading the failure path need both the headline reason
    // (verdict tail) and the reviewer's reasoning. The leading-path
    // accept must concatenate both.
    const completion = [
      'WARN: rename `doThing` to `dispatchTaskToReviewer`.',
      '',
      'The current name does not communicate intent. The rest of the',
      'diff is fine.',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('warn')
    expect(result.feedback).toContain('rename `doThing`')
    expect(result.feedback).toContain('does not communicate intent')
  })
})
