import { describe, expect, it } from 'vitest'

import { deriveTaskLabelFromPrompt } from '@/lib/task-prompt-label'

describe('deriveTaskLabelFromPrompt', () => {
  describe('impl tasks', () => {
    it('extracts the first markdown heading as a safe label', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '[redacted]',
        requiredRole: null,
        prompt: [
          '# P1: Webhook notification backend/runtime',
          '',
          '## Objective',
          'Build a webhook delivery loop.',
        ].join('\n'),
      })
      expect(label).toBe('P1: Webhook notification backend/runtime')
    })

    it('keeps the priority prefix for impl tasks so the badge stays meaningful', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '',
        requiredRole: null,
        prompt: '# P2 - Ductum CLI skill\n\nOperator-direct work.',
      })
      expect(label).toBe('P2 - Ductum CLI skill')
    })

    it('falls back to the first safe non-heading line when no heading exists', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '[redacted]',
        requiredRole: null,
        prompt: 'Build webhook notifications backend.\n\nLonger body follows here.',
      })
      expect(label).toBe('Build webhook notifications backend.')
    })

    it('uses a safe heading even when the prompt body contains redacted material', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '[redacted]',
        requiredRole: null,
        prompt: [
          '# P1: Webhook notification backend/runtime',
          '',
          '## Evidence',
          'Sensitive runtime output: [redacted]',
        ].join('\n'),
      })
      expect(label).toBe('P1: Webhook notification backend/runtime')
    })
  })

  describe('review tasks', () => {
    const reviewPrompt = [
      '## Review Task',
      '',
      'A different agent implemented the following task. Review their changes.',
      '',
      '### Reviewed commit',
      'abcdef123456',
      '',
      '### Original Task',
      '# P1: Webhook notification backend/runtime',
      '',
      '## Objective',
      'Build the delivery loop.',
      '',
      '### Verification Output (build + test)',
      '```',
      'all tests pass',
      '```',
    ].join('\n')

    it('derives "Review: <original heading>" without the priority prefix', () => {
      const label = deriveTaskLabelFromPrompt({
        name: 'review-P1',
        requiredRole: 'reviewer',
        prompt: reviewPrompt,
      })
      expect(label).toBe('Review: Webhook notification backend/runtime')
    })

    it('infers review tasks from prompt wrappers when the stored name is redacted', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '[redacted]',
        requiredRole: 'reviewer',
        prompt: reviewPrompt,
      })
      expect(label).toBe('Review: Webhook notification backend/runtime')
    })

    it('returns null when a review prompt has no Original Task section', () => {
      const label = deriveTaskLabelFromPrompt({
        name: 'review-P1',
        requiredRole: 'reviewer',
        prompt: '## Review Task\n\nReview the diff.\n',
      })
      expect(label).toBeNull()
    })

    it('uses a safe original-task heading even when the review body contains redacted material', () => {
      const label = deriveTaskLabelFromPrompt({
        name: 'review-P1',
        requiredRole: 'reviewer',
        prompt: reviewPrompt.replace('all tests pass', 'secret output: [redacted]'),
      })
      expect(label).toBe('Review: Webhook notification backend/runtime')
    })
  })

  describe('fix tasks', () => {
    const fixPrompt = [
      '## Fix Task (Review Round 1)',
      '',
      '### Original Task',
      '# P1: Webhook notification backend/runtime',
      '',
      '## Objective',
      'Build the delivery loop.',
      '',
      '### Review Feedback',
      'A reviewer found blocking issues:',
      '',
      'Whitespace broke.',
    ].join('\n')

    it('derives "Fix: <original heading>" without the priority prefix', () => {
      const label = deriveTaskLabelFromPrompt({
        name: 'fix-P1-r1',
        requiredRole: 'builder',
        prompt: fixPrompt,
      })
      expect(label).toBe('Fix: Webhook notification backend/runtime')
    })

    it('infers fix tasks from prompt wrappers when the stored name is redacted', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '[redacted]',
        requiredRole: 'builder',
        prompt: fixPrompt,
      })
      expect(label).toBe('Fix: Webhook notification backend/runtime')
    })

    it('treats warning cleanup prompts as fix-loop work when the stored name is redacted', () => {
      const label = deriveTaskLabelFromPrompt({
        name: '[redacted]',
        requiredRole: 'builder',
        prompt: fixPrompt.replace('## Fix Task (Review Round 1)', '## Warning Cleanup Task (Review Round 1)'),
      })
      expect(label).toBe('Fix: Webhook notification backend/runtime')
    })

    it('keeps the round number out of the derived label so the role badge stays the source of truth', () => {
      const roundTwoPrompt = fixPrompt.replace('Review Round 1', 'Review Round 2').replace('fix-P1-r1', 'fix-P1-r2')
      const label = deriveTaskLabelFromPrompt({
        name: 'fix-P1-r2',
        requiredRole: 'builder',
        prompt: roundTwoPrompt,
      })
      expect(label).toBe('Fix: Webhook notification backend/runtime')
    })
  })

  describe('safety guards', () => {
    it('returns null for empty prompts', () => {
      expect(deriveTaskLabelFromPrompt({ name: '', requiredRole: null, prompt: '' })).toBeNull()
      expect(deriveTaskLabelFromPrompt({ name: '', requiredRole: null, prompt: '   \n\t\n' })).toBeNull()
    })

    it('returns null when the derived heading contains a redaction marker', () => {
      expect(
        deriveTaskLabelFromPrompt({
          name: '',
          requiredRole: null,
          prompt: '# P1: [redacted] webhook task\n\nBody.',
        }),
      ).toBeNull()
    })

    it('returns null when the derived heading would expose a secret-shaped value', () => {
      expect(
        deriveTaskLabelFromPrompt({
          name: '',
          requiredRole: null,
          prompt: '# P1: Rotate ghp_abcdefghijklmnopqrstuvwxyz1234 before shipping',
        }),
      ).toBeNull()
      expect(
        deriveTaskLabelFromPrompt({
          name: '',
          requiredRole: null,
          prompt: '# P1: Rotate API_KEY=AKIAIOSFODNN7EXAMPLE before shipping',
        }),
      ).toBeNull()
      expect(
        deriveTaskLabelFromPrompt({
          name: '',
          requiredRole: null,
          prompt: '# P1: Rotate -----BEGIN RSA PRIVATE KEY----- before shipping',
        }),
      ).toBeNull()
    })

    it('truncates long headings at a word boundary with an ellipsis', () => {
      const longHeading = 'P1: Webhook notification backend and runtime delivery loop with retry semantics for the factory dispatcher and reviewer'
      const label = deriveTaskLabelFromPrompt({
        name: '',
        requiredRole: null,
        prompt: `# ${longHeading}\n\nBody.`,
      })
      expect(label).toMatch(/^P1: .+…$/)
      expect(label!.length).toBeLessThanOrEqual(84)
      expect(label).not.toMatch(/\[redacted\]|ghp_|API_KEY|PRIVATE KEY/i)
    })

    it('returns null when the original-task section is itself redacted', () => {
      const label = deriveTaskLabelFromPrompt({
        name: 'review-P1',
        requiredRole: 'reviewer',
        prompt: [
          '## Review Task',
          '',
          '### Original Task',
          '# P1: [redacted]',
          '',
          '### Diff',
          '```diff',
          'diff',
          '```',
        ].join('\n'),
      })
      expect(label).toBeNull()
    })
  })
})
