import { describe, expect, it } from 'vitest'
import { sanitizeGeneratedGitTitle } from '../generated-git-title.js'

describe('sanitizeGeneratedGitTitle', () => {
  describe('preserves descriptive product/code titles', () => {
    it('keeps a clean conventional title verbatim', () => {
      expect(sanitizeGeneratedGitTitle('Add operator approval queue')).toBe('Add operator approval queue')
    })

    it('preserves legitimate domain tokens such as S3 mid-text', () => {
      // Amazon S3 is a domain token, not a stage label. The sanitizer
      // must NOT strip it from titles that describe actual product work.
      expect(sanitizeGeneratedGitTitle('Add S3 storage backend')).toBe('Add S3 storage backend')
      expect(sanitizeGeneratedGitTitle('Wire S3 multi-region replication')).toBe('Wire S3 multi-region replication')
    })

    it('preserves short acronyms (API, CLI, S3) inside mixed uppercase slugs', () => {
      // API and S3 are short acronyms (≤3 chars); only the longer
      // CONFIGURATION word gets lowercased.
      expect(sanitizeGeneratedGitTitle('S3-API-CONFIGURATION')).toBe('S3 API configuration')
    })
  })

  describe('strips process/planning prefixes', () => {
    it('removes leading P* planning labels', () => {
      expect(sanitizeGeneratedGitTitle('P2: Prove GitHub issue comment-back')).toBe('Prove GitHub issue comment-back')
      expect(sanitizeGeneratedGitTitle('P3 Add settings panel')).toBe('Add settings panel')
    })

    it('removes leading post-P* phase labels', () => {
      expect(sanitizeGeneratedGitTitle('post-P9 closeout notes')).toBe('closeout notes')
      expect(sanitizeGeneratedGitTitle('Post-P9 closeout notes')).toBe('closeout notes')
    })

    it('removes leading p-* planning slugs', () => {
      expect(sanitizeGeneratedGitTitle('p-recovery final pass')).toBe('final pass')
    })

    it('removes bracketed prefixes that contain only process tokens', () => {
      expect(sanitizeGeneratedGitTitle('[post-P9 P4] Document one shared secret validator')).toBe(
        'Document one shared secret validator',
      )
    })
  })

  describe('strips stage labels but preserves S3 (token precision)', () => {
    it('removes leading S0, S1, S1a, S6 stage labels', () => {
      expect(sanitizeGeneratedGitTitle('S0: Define factory baseline')).toBe('Define factory baseline')
      expect(sanitizeGeneratedGitTitle('S1: Build core pipeline')).toBe('Build core pipeline')
      expect(sanitizeGeneratedGitTitle('S1a: Refine core pipeline')).toBe('Refine core pipeline')
      expect(sanitizeGeneratedGitTitle('S6: Ship to operators')).toBe('Ship to operators')
    })

    it('removes leading HOTFIX label', () => {
      expect(sanitizeGeneratedGitTitle('HOTFIX: Recover dropped PR reference')).toBe('Recover dropped PR reference')
    })

    it('PRESERVES leading S3 (Amazon S3 domain token, not a stage label)', () => {
      // This is the token-precision guarantee: S3 is a domain collision
      // with stage numbering, but S3 means Amazon S3 in real product
      // titles. The sanitizer must NOT strip it.
      expect(sanitizeGeneratedGitTitle('S3: Configure storage backend')).toBe('S3: Configure storage backend')
      expect(sanitizeGeneratedGitTitle('S3 add bucket lifecycle policy')).toBe('S3 add bucket lifecycle policy')
    })

    it('preserves S3 inside bracketed prefixes alongside other tokens', () => {
      // The bracketed prefix contains "S3" which is NOT a process token,
      // so the bracket is preserved (hasOnlyProcessTokens returns false).
      expect(sanitizeGeneratedGitTitle('[S3] Configure storage backend')).toBe('[S3] Configure storage backend')
    })

    it('removes lowercase stage labels (s0, s1, s1a)', () => {
      expect(sanitizeGeneratedGitTitle('s0: Define factory baseline')).toBe('Define factory baseline')
      expect(sanitizeGeneratedGitTitle('s1a refine pipeline')).toBe('refine pipeline')
    })
  })

  describe('converts uppercase slugs into readable titles', () => {
    it('splits dashed uppercase slugs and lowercases long words while keeping short acronyms', () => {
      expect(sanitizeGeneratedGitTitle('P4-RECOVER-PR-REFERENCE-CLAMP-CLEAN-COMMIT')).toBe(
        'recover PR reference clamp clean commit',
      )
    })
  })

  describe('fallbacks', () => {
    it('returns empty string for empty/whitespace input', () => {
      expect(sanitizeGeneratedGitTitle('')).toBe('')
      expect(sanitizeGeneratedGitTitle('   ')).toBe('')
    })

    it('folds to "task" when sanitization strips all content', () => {
      // Even though the placeholder fails the public-metadata gate, the
      // sanitizer itself returns a non-empty placeholder so PR-title
      // callers never emit `feat: ` with an empty body. The gate is the
      // hard fail-closed point; this fallback is defensive.
      expect(sanitizeGeneratedGitTitle('P3')).toBe('task')
      expect(sanitizeGeneratedGitTitle('[post-P9 P4]')).toBe('task')
      expect(sanitizeGeneratedGitTitle('HOTFIX')).toBe('task')
    })
  })
})
