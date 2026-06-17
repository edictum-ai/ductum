import { describe, expect, it } from 'vitest'

import { buildSpecContractReport } from '../spec-contract-audit.js'
import { readyTask, spec } from './helpers.js'

describe('spec contract audit heuristics', () => {
  it('requires section bodies for trace, verification, and drift coverage', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior')
          .replace('## Verification\n- pnpm test', '## Verification')
          .replace('## Drift handling\n- Record a decision before changing scope.', '## Drift handling'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing Verification')
    expect(report.warnings.join('\n')).toContain('missing Drift handling')
  })

  it('pins the two-thirds behavioral item threshold', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          '- Every runtime behavior claim must have behavioral tests or recorded evidence.',
          '- This is only filler.',
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('needs at least 2 behavioral items')
  })

  it('counts behavioral test evidence when it names the failing surface', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior')
          .replace('- Missing Task behavior evidence must fail loudly in CLI output.', '- Test must reject missing targetRef inputs in CLI output.')
          .replace('- Every runtime behavior claim must have behavioral tests or recorded evidence.', '- Invalid YAML target refs must fail before task creation.'),
      }],
    })

    expect(report.incomplete).toBe(false)
  })

  it('counts wrapped correction-verb behavior contracts with normal failure verbs', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          [
            '- Missing Task behavior evidence must fail loudly in CLI output.',
            '- Every runtime behavior claim must have behavioral tests or recorded evidence.',
          ].join('\n'),
          [
            '- [ ] REJECTS delete/restore without the `memory:delete` scope; both are',
            '  audited and id-addressed; evidence: `pnpm test`.',
            '- [ ] FAILS on a partial `supersedes` transaction where new rows are',
            '  stored but listed ids are not soft-deleted; evidence: `pnpm test`.',
            '- [ ] FAILS review if duplicate/update overwrites first-writer provenance;',
            '  evidence: `git diff src/storage.ts`.',
            '- [ ] FAILS review when rows are addressed by natural key instead of',
            '  `memoryId`; evidence: Umzug migration + `docs/contracts.md` diff.',
          ].join('\n'),
        ),
      }],
    })

    expect(report.incomplete).toBe(false)
  })

  it('explains which behavior contract bullets are weak', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          [
            '- Missing Task behavior evidence must fail loudly in CLI output.',
            '- Every runtime behavior claim must have behavioral tests or recorded evidence.',
          ].join('\n'),
          [
            '- [ ] Keep the docs tidy.',
            '- [ ] No new dependencies.',
          ].join('\n'),
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak items:')
    expect(report.warnings.join('\n')).toContain('Example: "- Runtime must reject invalid input; evidence: pnpm test."')
  })

  it('does not count review-only meta text as runtime behavior', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior')
          .replace('- Missing Task behavior evidence must fail loudly in CLI output.', '- PASS review must be invalid unless the Behavior Contract is addressed explicitly.')
          .replace('- Every runtime behavior claim must have behavioral tests or recorded evidence.', '- Review behavior must be reported as incomplete.'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Behavior Contract')
  })

  it('keeps headings inside longer fenced code blocks hidden', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: [
          '## Decision Trace',
          '- Decisions: 066',
          '',
          '````md',
          '```md',
          '## Behavior Contract',
          '- Missing target refs must fail loudly.',
          '```',
          '````',
          '',
          '## Verification',
          '- pnpm test',
          '',
          '## Drift handling',
          '- Record drift before changing scope.',
          '',
          '## Slop Review',
          '- Did every Behavior Contract item get a behavioral test or explicit evidence?',
          '- Are missing or invalid inputs loud failures?',
        ].join('\n'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing a Behavior Contract')
  })

  it('keeps inline Decision Trace examples inside fenced code blocks hidden', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          '## Decision Trace\n- Decisions: `066`.',
          '```md\nDecision Trace: 066\n```',
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing a Decision Trace')
  })

  it('keeps inline Decision Trace examples inside indented code blocks hidden', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          '## Decision Trace\n- Decisions: `066`.',
          '    Decision Trace: 066',
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing a Decision Trace')
  })

  it('keeps indented code block headings hidden', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          '## Behavior Contract',
          '    ## Behavior Contract',
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing a Behavior Contract')
  })
})

function completePrompt(label: string): string {
  return [
    '## Decision Trace',
    '- Decisions: `066`.',
    '',
    '## Behavior Contract',
    '',
    `- Missing ${label} evidence must fail loudly in CLI output.`,
    '- Every runtime behavior claim must have behavioral tests or recorded evidence.',
    '',
    '## Verification',
    '- pnpm test',
    '',
    '## Drift handling',
    '- Record a decision before changing scope.',
    '',
    '## Slop Review',
    '- Did every Behavior Contract item get tested or evidenced?',
    '- Are missing or invalid inputs loud failures?',
  ].join('\n')
}
