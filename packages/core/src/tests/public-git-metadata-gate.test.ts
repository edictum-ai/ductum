import { describe, expect, it } from 'vitest'
import {
  assertPublicGitMetadataSafe,
  checkPublicGitMetadata,
  PublicGitMetadataError,
} from '../public-git-metadata-gate.js'

describe('checkPublicGitMetadata', () => {
  describe('positive metadata (descriptive product/code changes)', () => {
    const goodSubjects = [
      'feat: add operator approval queue',
      'fix(api): preserve S3 tokens in PR titles',
      'chore(worktree): save uncommitted files for recovery pass',
      'docs: document S3 storage backend contract',
      'refactor(core): split sanitizeGeneratedGitTitle helper',
      'test: pin stage label preservation under S3 collision',
      'feat(s3): wire multi-region replication',
      'fix: guard against session label injection',
      'feat: render runtime verification evidence',
      'fix: runner cleanup',
      'docs: add runbook',
      'fix: attempted retry cleanup',
      'docs: sessions overview',
      'feat: reduce P95 latency',
      'fix: compare P99 regression',
      'perf: P95 latency dashboard',
    ]

    for (const subject of goodSubjects) {
      it(`accepts ${JSON.stringify(subject)}`, () => {
        const check = checkPublicGitMetadata(subject)
        expect(check.ok).toBe(true)
        expect(check.reasons).toEqual([])
      })
    }

    it('accepts a descriptive title with a benign body', () => {
      const check = checkPublicGitMetadata(
        'feat: add approval queue',
        '## Summary\n- Adds the operator queue\n\n## Verification\n- pnpm test\n',
      )
      expect(check.ok).toBe(true)
    })

    it('accepts S3 as a legitimate domain token in subject and body', () => {
      const check = checkPublicGitMetadata(
        'feat(s3): add multi-region replication',
        '## Summary\n- Configures S3 cross-region replication\n',
      )
      expect(check.ok).toBe(true)
    })
  })

  describe('forbidden process/session/spec tokens', () => {
    const forbiddenCases: Array<[string, RegExp]> = [
      ['feat: S0 baseline', /stage label S0/],
      ['feat: S1 pipeline', /stage label S1/],
      ['feat: S1a refine pipeline', /stage label S1/],
      ['feat: S6 ship', /stage label S6/],
      ['fix: HOTFIX recovery', /HOTFIX/],
      ['feat: P3 settings panel', /planning label/],
      ['feat: p4 recovery', /planning label/],
      ['fix: fix-p4-recover branch', /planning label/],
      ['feat: post-P9 closeout', /post-P\* stage label/],
      ['fix: p-recovery follow-up', /planning slug/],
      ['feat: session-abc123 metadata', /session label/],
      ['feat: session:abc123 metadata', /session label/],
      ['fix: attempt-xyz123 merge', /attempt label/],
      ['fix: attempt_abc123 merge', /attempt label/],
      ['feat: run-PNaAk2 label', /run label/],
    ]

    for (const [subject, reasonPattern] of forbiddenCases) {
      it(`rejects ${JSON.stringify(subject)}`, () => {
        const check = checkPublicGitMetadata(subject)
        expect(check.ok).toBe(false)
        expect(check.reasons.some((reason) => reasonPattern.test(reason))).toBe(true)
      })
    }

    it('does NOT reject S3 as a forbidden token (token precision)', () => {
      // The forbidden-token list deliberately omits S3 because S3 is a
      // legitimate domain token (Amazon S3). Stage labels S0, S1, S1a,
      // S6, etc. fail; S3 passes.
      const check = checkPublicGitMetadata('feat(s3): wire bucket lifecycle policy')
      expect(check.ok).toBe(true)
    })
  })

  describe('token precision', () => {
    it('rejects lowercase stage labels (s0, s1, s1a) but preserves S3', () => {
      expect(checkPublicGitMetadata('feat: s0 baseline').ok).toBe(false)
      expect(checkPublicGitMetadata('feat: s1 pipeline').ok).toBe(false)
      expect(checkPublicGitMetadata('feat: S3 storage backend').ok).toBe(true)
    })

    it('preserves S3 alongside other legitimate short acronyms', () => {
      expect(checkPublicGitMetadata('feat: add S3, API, and CLI surfaces').ok).toBe(true)
    })

    it('matches stage labels on word boundaries only (S1 inside a word stays)', () => {
      // `S1` as a substring of a real product term should not be rejected.
      // E.g. "MS1A receptor" or "S10n" (sic) would not be stage labels.
      expect(checkPublicGitMetadata('feat: add MS1A receptor binding').ok).toBe(true)
    })
  })

  describe('newline / body injection', () => {
    it('rejects subjects containing a newline (body injection)', () => {
      const check = checkPublicGitMetadata('feat: add queue\n\nCo-Authored-By: agent')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('newline'))).toBe(true)
    })

    it('rejects subjects containing a carriage return', () => {
      const check = checkPublicGitMetadata('feat: add queue\r\ninjected')
      expect(check.ok).toBe(false)
    })

    it('rejects body with explicit AI attribution lines', () => {
      const check = checkPublicGitMetadata('feat: add queue', '## Summary\n- adds queue\n\nCo-Authored-By: bot')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('AI attribution'))).toBe(true)
    })

    it('rejects PR titles with explicit AI attribution descriptions', () => {
      for (const subject of ['feat: Generated with Claude', 'fix: 🤖 Generated by bot', 'docs: generated-by: assistant']) {
        const check = checkPublicGitMetadata(subject)
        expect(check.ok).toBe(false)
        expect(check.reasons.some((reason) => reason.includes('AI attribution'))).toBe(true)
      }
    })

    it('rejects bulleted co-author attribution lines', () => {
      const check = checkPublicGitMetadata('feat: add queue', '## Summary\n- Co-Authored-By: bot\n')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('AI attribution'))).toBe(true)
    })

    it('rejects body with the robot emoji attribution line', () => {
      const check = checkPublicGitMetadata('feat: add queue', '🤖 Generated with Claude')
      expect(check.ok).toBe(false)
    })

    it('rejects bulleted robot attribution lines', () => {
      const check = checkPublicGitMetadata('feat: add queue', '## Summary\n- 🤖 Generated with Claude\n')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('AI attribution'))).toBe(true)
    })

    it('rejects bulleted generated attribution lines', () => {
      const check = checkPublicGitMetadata('feat: add queue', '## Summary\n- Generated with Claude\n')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('AI attribution'))).toBe(true)
    })

    it('does NOT reject body that merely mentions AI in prose', () => {
      const check = checkPublicGitMetadata(
        'feat: add queue',
        '## Summary\n- Documents the AI agent contract for reviewers\n',
      )
      expect(check.ok).toBe(true)
    })

    it('rejects body lines containing forbidden process tokens', () => {
      const check = checkPublicGitMetadata(
        'feat: add queue',
        '## Summary\n- generated branch: p-recovery\n- session-abc123\n- Branch: feat/p4-recover\n',
      )
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('planning slug'))).toBe(true)
      expect(check.reasons.some((reason) => reason.includes('session label'))).toBe(true)
      expect(check.reasons.some((reason) => reason.includes('planning label'))).toBe(true)
    })

    it('rejects hyphen-delimited planning labels in generated branch names', () => {
      const check = checkPublicGitMetadata('feat: add queue', '## Summary\n- Branch: fix-p4-recover\n')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('planning label'))).toBe(true)
    })

    it('rejects P-label branch paths with custom prefixes', () => {
      const check = checkPublicGitMetadata('feat: add queue', '## Summary\n- Branch: topic/p4-recover\n')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('branch planning label'))).toBe(true)
    })

    it('rejects body lines with explicit internal id labels', () => {
      const check = checkPublicGitMetadata(
        'feat: add queue',
        '## Summary\n- Attempt: abc123\n- Run: xyz789\n',
      )
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('AI attribution or factory prose'))).toBe(true)
    })

    it('does NOT reject body text with runtime, runner, runbook, attempted, or sessions prose', () => {
      const check = checkPublicGitMetadata(
        'docs: add runbook',
        '## Summary\n- Documents runtime verification, attempted retries, sessions, and runner cleanup in the runbook\n',
      )
      expect(check.ok).toBe(true)
    })

    it('does NOT reject percentile P-number terms in branch/body prose', () => {
      const check = checkPublicGitMetadata(
        'feat: reduce P95 latency',
        '## Summary\n- Branch: feat/reduce-p99-latency\n- Keeps P95 and P99 latency metrics visible\n',
      )
      expect(check.ok).toBe(true)
    })

    it('does NOT reject P-number repo path segments in source links', () => {
      const check = checkPublicGitMetadata(
        'feat: link source issue',
        '## Summary\n- Source: https://github.com/acme/p4-tools/issues/123\n- Repository: acme/p4-tools\n',
      )
      expect(check.ok).toBe(true)
    })

    it('does NOT reject source repo names that look like process words', () => {
      const check = checkPublicGitMetadata(
        'feat: link source issue',
        '## Summary\n- Source: https://github.com/acme/run-tracker/issues/123\n- Repository: acme/session-service\n- Related: acme/attempt-logger\n',
      )
      expect(check.ok).toBe(true)
    })
  })

  describe('non-conventional and placeholder subjects', () => {
    it('rejects subjects without a conventional type prefix', () => {
      const check = checkPublicGitMetadata('add operator approval queue')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('conventional'))).toBe(true)
    })

    it('rejects empty subjects', () => {
      expect(checkPublicGitMetadata('').ok).toBe(false)
      expect(checkPublicGitMetadata('   ').ok).toBe(false)
    })

    it('rejects the synthetic placeholder "feat: task"', () => {
      // sanitizeGeneratedGitTitle folds stripped titles to "task"; the
      // gate treats that as synthetic metadata-only text and fails
      // closed so the operator must supply a real description.
      const check = checkPublicGitMetadata('feat: task')
      expect(check.ok).toBe(false)
      expect(check.reasons.some((reason) => reason.includes('placeholder'))).toBe(true)
    })

    it('rejects "fix: placeholder" and "chore: untitled"', () => {
      expect(checkPublicGitMetadata('fix: placeholder').ok).toBe(false)
      expect(checkPublicGitMetadata('chore: untitled').ok).toBe(false)
    })

    it('accepts conventional subjects with scope', () => {
      expect(checkPublicGitMetadata('feat(core): add helper').ok).toBe(true)
      expect(checkPublicGitMetadata('fix(api/s3): preserve token').ok).toBe(true)
    })
  })
})

describe('assertPublicGitMetadataSafe', () => {
  it('returns without throwing for safe metadata', () => {
    expect(() => assertPublicGitMetadataSafe('feat: add queue', '## Summary\n- queue\n')).not.toThrow()
  })

  it('throws PublicGitMetadataError with the failing reasons', () => {
    try {
      assertPublicGitMetadataSafe('feat: P3 settings panel')
      throw new Error('expected assertPublicGitMetadataSafe to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PublicGitMetadataError)
      expect((error as PublicGitMetadataError).reasons.some((r) => r.includes('planning label'))).toBe(true)
    }
  })

  it('aggregates multiple reasons when several checks fail', () => {
    try {
      assertPublicGitMetadataSafe('S0: P3 hotfix\n\nCo-Authored-By: bot')
      throw new Error('expected assertPublicGitMetadataSafe to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PublicGitMetadataError)
      const reasons = (error as PublicGitMetadataError).reasons.join('; ')
      // Multiple failures: non-conventional (no `type:`), forbidden tokens,
      // newline injection, body attribution.
      expect(reasons.match(/stage label S0/)).toBeTruthy()
      expect(reasons.match(/planning label/)).toBeTruthy()
    }
  })
})
