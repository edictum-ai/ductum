import { describe, expect, it } from 'vitest'

import { buildSpecContractReport } from '../spec-contract-audit.js'
import { readyTask, spec } from './helpers.js'

describe('spec contract audit', () => {
  it('reports missing Behavior Contract coverage as incomplete', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{ ...readyTask, prompt: 'Decision Trace: 060\nDo work.\nVerification: pnpm test' }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Task Ready Task'),
      expect.stringContaining('Behavior Contract'),
    ]))
    expect(report.markdown).toContain('Status: incomplete')
    expect(report.markdown).toContain('Heuristic: this checks markdown coverage only')
  })

  it('calls shape-only Behavior Contracts weak', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: [
          '## Decision Trace',
          '- Decisions: 060',
          '',
          '## Behavior Contract',
          '',
          '- Task must have a targetId field.',
          '- YAML parses with targetRef.',
          '',
          '## Verification',
          '- pnpm test',
          '',
          '## Drift handling',
          '- Record drift before changing scope.',
          '',
          '## Slop Review',
          '- Check behavior.',
        ].join('\n'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Behavior Contract')
  })

  it('does not treat a generic review checklist as Slop Review', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace('## Slop Review', '## Review Checklist'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing Slop Review')
  })

  it('calls weak Slop Review sections weak even when present', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          '- Did every Behavior Contract item get tested or evidenced?',
          '- Anything missing?',
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Slop Review')
  })

  it('does not count non-goal-only contracts as behavioral coverage', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: [
          '## Decision Trace',
          '- Decisions: 066',
          '',
          '## Behavior Contract',
          '',
          '- This must not add a second policy engine.',
          '- No formal graph analyzer should be introduced.',
          '- Do not automatically prove every contract.',
          '',
          '## Verification',
          '- pnpm test',
          '',
          '## Drift handling',
          '- Record drift before changing scope.',
          '',
          '## Slop Review',
          '- Did every Behavior Contract item get a behavioral test or explicit evidence?',
        ].join('\n'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Behavior Contract')
  })

  it('does not count test-only process notes as behavioral coverage', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: [
          '## Decision Trace',
          '- Decisions: 066',
          '',
          '## Behavior Contract',
          '',
          '- Add unit test for the targetId field.',
          '- Add test coverage for YAML parsing.',
          '',
          '## Verification',
          '- pnpm test',
          '',
          '## Drift handling',
          '- Record drift before changing scope.',
          '',
          '## Slop Review',
          '- Did every Behavior Contract item get a behavioral test or explicit evidence?',
        ].join('\n'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Behavior Contract')
  })

  it('does not count content-free behavior filler as behavioral coverage', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior')
          .replace('- Missing Task behavior evidence must fail loudly in CLI output.', '- Spec must fail when behavior is missing.')
          .replace('- Every runtime behavior claim must have behavioral tests or recorded evidence.', '- Behavior should be covered by tests.'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Behavior Contract')
  })

  it('requires more than one behavioral item', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior')
          .replace('- Every runtime behavior claim must have behavioral tests or recorded evidence.', '- Behavior should be covered by tests.'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Behavior Contract')
  })

  it('does not count non-goal-only Slop Review items as strong review coverage', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: completePrompt('Task behavior').replace(
          '- Did every Behavior Contract item get tested or evidenced?',
          '- Did this add a second policy engine?',
        ),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('weak Slop Review')
  })

  it('keeps nested subheadings inside Behavior Contract sections', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: [
          '## Decision Trace',
          '- Decisions: 066',
          '',
          '## Behavior Contract',
          '',
          '### Import errors',
          '',
          '- Missing target refs must fail loudly in CLI output.',
          '- Invalid target refs must be rejected before task creation.',
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

    expect(report.warnings.join('\n')).not.toContain('Task Ready Task')
  })

  it('ignores Behavior Contract headings inside fenced code blocks', () => {
    const report = buildSpecContractReport({
      spec: { ...spec, document: completePrompt('Spec behavior') },
      tasks: [{
        ...readyTask,
        prompt: [
          '## Decision Trace',
          '- Decisions: 066',
          '',
          '```md',
          '## Behavior Contract',
          '- Missing target refs must fail loudly.',
          '```',
          '',
          '## Verification',
          '- pnpm test',
          '',
          '## Drift handling',
          '- Record drift before changing scope.',
          '',
          '## Slop Review',
          '- Did every Behavior Contract item get a behavioral test or explicit evidence?',
        ].join('\n'),
      }],
    })

    expect(report.incomplete).toBe(true)
    expect(report.warnings.join('\n')).toContain('missing a Behavior Contract')
  })
})

function completePrompt(label: string): string {
  return [
    '## Decision Trace',
    '- Decisions: `060`.',
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
