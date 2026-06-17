import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  buildReviewPrompt,
  collectDiff,
  parseReviewResult,
  REVIEW_VERDICT_FORMAT_RULE,
  verifyWorktree,
} from '../post-completion.js'
import { createId, type Task } from '../types.js'

const gitFixtureTimeoutMs = 20_000

function createGitFixture(): { root: string; worktree: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-review-diff-'))
  const worktree = path.join(root, 'repo')
  fs.mkdirSync(worktree)
  const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(worktree, 'README.md'), 'base\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'base')
  git('checkout', '-b', 'feature/review-diff')
  fs.writeFileSync(path.join(worktree, 'feature.txt'), 'committed change\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'feature change')
  return { root, worktree }
}

function makeOriginalTask(prompt: string): Task {
  return {
    id: createId<'TaskId'>(),
    specId: createId<'SpecId'>(),
    targetId: null,
    name: 'P1',
    prompt,
    repos: [],
    assignedAgentId: null,
    requiredRole: 'builder',
    complexity: 'simple',
    status: 'ready',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('buildReviewPrompt verdict format', () => {
  it('demands exactly one terminal verdict line', () => {
    const prompt = buildReviewPrompt(makeOriginalTask('do the thing'), '(diff)', '(verify ok)')

    // Section header is unmissable in the rendered prompt.
    expect(prompt).toContain('REQUIRED VERDICT FORMAT')
    // Each verdict word is shown as the explicit terminal-line form.
    expect(prompt).toContain('PASS')
    expect(prompt).toContain('PASS: <one-line summary>')
    expect(prompt).toContain('WARN: <specific cleanup findings>')
    expect(prompt).toContain('FAIL: <specific blocking findings>')
    // The prompt explicitly tells the agent the verdict line must be
    // the LAST non-empty line as a fallback path.
    expect(prompt).toContain('LAST non-empty line')
    // And explicitly warns that prose mentions without an anchor are rejected.
    expect(prompt).toContain('rejected as malformed')
  })

  it('does not encourage prose-prefixed verdicts that the parser would reject', () => {
    // Regression guard: the prior prompt said "result starting with
    // PASS:". The new prompt must not promise prefix-based parsing
    // (which could lead an agent to glue prose after PASS:).
    const prompt = buildReviewPrompt(makeOriginalTask('do the thing'), '(diff)', '(verify ok)')

    expect(prompt).not.toContain('starting with "PASS:"')
    expect(prompt).not.toContain('starting with "WARN:"')
    expect(prompt).not.toContain('starting with "FAIL:"')
  })

  it('pre-fills the `## Final verdict` section so any LLM puts the verdict where the parser looks', () => {
    // Decision 116: the prompt must explicitly direct the reviewer to
    // emit a `## Final verdict` heading with the verdict immediately
    // beneath it. This is the section-anchored path that lets Codex's
    // habitual prose-mixed style coexist with the strict parser.
    const prompt = buildReviewPrompt(makeOriginalTask('do the thing'), '(diff)', '(verify ok)')

    expect(prompt).toContain('## Final verdict')
    expect(prompt).toContain('Template')
    expect(prompt).toContain('<verdict>')
  })
})

describe('parseReviewResult', () => {
  it('fails closed when a reviewer completion is empty', () => {
    const result = parseReviewResult('')

    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
    expect(result.malformed).toBe(true)
    expect(result.feedback).toContain('Malformed reviewer completion: empty result')
    expect(result.feedback).toContain(REVIEW_VERDICT_FORMAT_RULE)
  })

  it('fails closed when only whitespace was reported', () => {
    const result = parseReviewResult('   \n\t\n   ')

    expect(result.malformed).toBe(true)
    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
  })

  it('fails closed when a reviewer omits the required terminal verdict line', () => {
    const result = parseReviewResult('Looks good to me')

    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
    expect(result.malformed).toBe(true)
    expect(result.feedback).toContain('terminal line was not a verdict')
    expect(result.feedback).toContain(REVIEW_VERDICT_FORMAT_RULE)
    expect(result.feedback).toContain('Looks good to me')
  })

  it('fails closed when the verdict word is buried in prose without a terminal verdict line', () => {
    // The prior parser only checked the prefix, so a casual mention of
    // "PASS" in prose would have been accepted. Now the LAST non-empty
    // line is what counts, and a sentence that merely mentions PASS
    // does not match the verdict regex.
    const result = parseReviewResult('Overall I think this is a PASS in spirit but I have a few worries.')

    expect(result.malformed).toBe(true)
    expect(result.verdict).toBe('fail')
    expect(result.passed).toBe(false)
  })

  it('fails closed when prose follows a verdict line on the same line', () => {
    // "PASS but with concerns" is not a clean PASS line. The regex
    // only accepts PASS or `PASS: <feedback>`, not arbitrary trailing
    // text glued to the verdict word.
    const result = parseReviewResult('PASS but with concerns about the helper')

    expect(result.malformed).toBe(true)
    expect(result.verdict).toBe('fail')
  })

  it('accepts a single-line PASS verdict with feedback', () => {
    expect(parseReviewResult('PASS: looks good')).toEqual({
      verdict: 'pass',
      passed: true,
      feedback: 'looks good',
    })
  })

  it('accepts a bare PASS terminal line', () => {
    expect(parseReviewResult('PASS')).toEqual({
      verdict: 'pass',
      passed: true,
      feedback: '',
    })
  })

  it('accepts WARN: with a feedback summary', () => {
    expect(parseReviewResult('WARN: rename the helper')).toEqual({
      verdict: 'warn',
      passed: false,
      feedback: 'rename the helper',
    })
  })

  it('accepts FAIL: with a feedback summary', () => {
    expect(parseReviewResult('FAIL: still broken')).toEqual({
      verdict: 'fail',
      passed: false,
      feedback: 'still broken',
    })
  })

  it('accepts a multi-line review where the verdict is the final non-empty line', () => {
    const completion = [
      'I checked the diff. The new helper looks correct.',
      'Tests cover the new branch.',
      '',
      'PASS: ready to ship',
    ].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('pass')
    expect(result.passed).toBe(true)
    expect(result.malformed).toBeFalsy()
    expect(result.feedback).toContain('I checked the diff')
    expect(result.feedback).toContain('ready to ship')
  })

  it('treats trailing blank lines as cosmetic when locating the terminal verdict line', () => {
    const completion = ['Notes about the diff.', '', 'WARN: clean up the rename', '   ', ''].join('\n')

    const result = parseReviewResult(completion)

    expect(result.verdict).toBe('warn')
    expect(result.passed).toBe(false)
    expect(result.feedback).toContain('clean up the rename')
    expect(result.feedback).toContain('Notes about the diff')
  })


  it('is case-insensitive on the verdict keyword', () => {
    expect(parseReviewResult('pass: sounds good')).toMatchObject({ verdict: 'pass', passed: true })
    expect(parseReviewResult('Warn: some cleanup needed')).toMatchObject({ verdict: 'warn', passed: false })
    expect(parseReviewResult('fail: bad')).toMatchObject({ verdict: 'fail', passed: false })
  })
})

// `## Final verdict` section-anchor cases (Decision 116) and the
// leading-verdict acceptance path (Decision 123, P3.3) live in
// `parse-review-result-leading-verdict.test.ts` to keep this file
// under the 300 LOC discipline.

describe('collectDiff', () => {
  it('includes committed branch changes against the base branch', async () => {
    const fixture = createGitFixture()
    try {
      const diff = await collectDiff(fixture.worktree, 'main')

      expect(diff).toContain('feature.txt')
      expect(diff).toContain('+committed change')
      expect(diff).not.toBe('(no changes detected)')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  }, gitFixtureTimeoutMs)

  it('keeps staged, unstaged, and untracked changes in the review diff', async () => {
    const fixture = createGitFixture()
    try {
      fs.writeFileSync(path.join(fixture.worktree, 'staged.txt'), 'staged change\n')
      execFileSync('git', ['-C', fixture.worktree, 'add', 'staged.txt'], { stdio: 'pipe' })
      fs.appendFileSync(path.join(fixture.worktree, 'README.md'), 'unstaged change\n')
      fs.writeFileSync(path.join(fixture.worktree, 'untracked.txt'), 'untracked change\n')

      const diff = await collectDiff(fixture.worktree, 'main')

      expect(diff).toContain('staged.txt')
      expect(diff).toContain('unstaged change')
      expect(diff).toContain('untracked change')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  }, gitFixtureTimeoutMs)
})

describe('verifyWorktree', () => {
  it('does not leak the server operator token into verification commands', async () => {
    const originalOperatorToken = process.env.DUCTUM_OPERATOR_TOKEN
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-verify-env-'))
    process.env.DUCTUM_OPERATOR_TOKEN = 'local-demo-token'
    try {
      const result = await verifyWorktree(root, [
        'test -z "$DUCTUM_OPERATOR_TOKEN"',
      ])

      expect(result.passed).toBe(true)
    } finally {
      if (originalOperatorToken == null) {
        delete process.env.DUCTUM_OPERATOR_TOKEN
      } else {
        process.env.DUCTUM_OPERATOR_TOKEN = originalOperatorToken
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('keeps a passing command green when its output exceeds the 1 MB execFile default', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-verify-buf-'))
    try {
      // ~4 MB to stdout then exit 0 — overflows the default buffer; the run must
      // still be reported as passed (regression: ERR_CHILD_PROCESS_STDIO_MAXBUFFER).
      const result = await verifyWorktree(root, [
        `node -e "process.stdout.write('x'.repeat(4*1024*1024)); process.exit(0)"`,
      ])

      expect(result.passed).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
