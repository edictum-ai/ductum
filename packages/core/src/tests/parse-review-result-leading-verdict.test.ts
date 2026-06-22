import { describe, expect, it } from 'vitest'

import { parseReviewResult } from '../post-completion.js'

/**
 * P2 structured review contract supersedes the legacy Decision 123
 * leading-verdict parser path. These fixtures remain as regression
 * coverage to prove old Codex-style prose verdicts fail closed instead
 * of silently counting as PASS/WARN/FAIL.
 */
describe('parseReviewResult legacy leading-verdict rejection', () => {
  it('rejects Codex-style PASS prose where the verdict opens the completion', () => {
    const result = parseReviewResult([
      'PASS: implementation matches the task and verify is green.',
      '',
      'Detailed review:',
      '- The new helper is named appropriately and is tested.',
    ].join('\n'))

    expect(result).toMatchObject({ verdict: 'fail', passed: false, malformed: true })
    expect(result.feedback).toContain('ductum-review-result')
  })

  it('rejects Codex-style WARN/FAIL prose even when the verdict is first or last', () => {
    expect(parseReviewResult('WARN: rename the helper')).toMatchObject({
      verdict: 'fail',
      passed: false,
      malformed: true,
    })
    expect(parseReviewResult('Notes\n\nFAIL: still broken')).toMatchObject({
      verdict: 'fail',
      passed: false,
      malformed: true,
    })
  })

  it('rejects structured-looking prose with final verdict headings', () => {
    const result = parseReviewResult([
      'Review notes look reasonable.',
      '',
      '## Final verdict',
      '',
      'PASS: ready to ship',
    ].join('\n'))

    expect(result).toMatchObject({ verdict: 'fail', passed: false, malformed: true })
  })

  it('still accepts the strict JSON structured contract', () => {
    expect(parseReviewResult(JSON.stringify({
      kind: 'ductum-review-result',
      verdict: 'pass',
      summary: 'ready to ship',
      findings: [],
    }))).toEqual({ verdict: 'pass', passed: true, feedback: 'ready to ship' })
  })
})
