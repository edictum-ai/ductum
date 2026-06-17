/**
 * Post-completion pipeline — verify and review after an agent finishes.
 *
 * Flow:
 *   Agent completes → verify (build+test in worktree) → review (different agent)
 *     → pass: ready to ship
 *     → fail: dispatch fix task with review feedback
 *
 * This is factory orchestration, not Edictum enforcement.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log } from './logger.js'
import type { AgentId, Run, RunId, RunWorkflowProfileSnapshot, Task } from './types.js'

const execFileAsync = promisify(execFile)

export interface VerifyResult {
  passed: boolean
  output: string
}

export type CodeReviewVerdict = 'pass' | 'warn' | 'fail'

export interface CodeReviewResult {
  verdict: CodeReviewVerdict
  passed: boolean
  feedback: string
  malformed?: boolean
}

export interface PostCompletionConfig {
  /** Commands to run in the worktree after agent completes (from workflow profile). */
  resolveVerifyCommands?: (projectName: string, workflowProfile?: RunWorkflowProfileSnapshot) => string[] | undefined
  /** Given the implementing agent, return a different agent for review. */
  resolveReviewerAgent?: (implementingAgentId: AgentId, projectId: string) => AgentId | null
  /** Persist verification output/evidence. */
  onVerificationResult?: (runId: RunId, result: VerifyResult) => Promise<void> | void
  /** Factory-controlled transition into ship stage. */
  onReadyToShip?: (runId: RunId) => Promise<void> | void
  /** Called when a review run completes — resolve the completion text for the review. */
  resolveRunCompletionText?: (runId: RunId) => string | null
  /** Persist parsed review verdict/evidence. */
  onReviewResult?: (runId: RunId, result: CodeReviewResult) => Promise<void> | void
  /**
   * Max number of fix iterations in a single impl→review→fix→review
   * chain before the root impl run is escalated to failed.
   * Default: 3.
   */
  maxFixIterations?: number
  /**
   * @deprecated Use `maxFixIterations`. This field was misnamed — it
   * caps fix iterations, not review rounds. Kept as a fallback so
   * existing callers don't break. Remove in a future major.
   */
  maxReviewRounds?: number
  /**
   * Branch to rebase the worktree onto before verify runs. When set
   * (e.g. "main"), runImplCompletion will pull the latest changes from
   * this branch into the worktree before validation. If the rebase
   * fails, a fix-rebase task is dispatched so the agent can resolve
   * the conflict. When null/undefined, no rebase is attempted (same as
   * the old behavior — conflicts surface to the human at merge time).
   */
  rebaseBase?: string
}

export interface RebaseResult {
  /** True when the worktree is now up-to-date with `base`. False on
   *  conflict or error. */
  rebased: boolean
  /** True when the rebase was attempted (i.e. base had advanced past
   *  the worktree's branchpoint). False when no rebase was needed. */
  needed: boolean
  /** Captured stderr/stdout when something failed. Empty on success. */
  output: string
}

/**
 * Rebase the worktree's current branch onto `base` (e.g. main). Returns
 * { rebased: true, needed: false } when no rebase was needed (the
 * branchpoint already matches HEAD of base). Returns
 * { rebased: false, needed: true, output } on conflict — the rebase is
 * automatically aborted to leave the worktree in a clean state so the
 * caller can dispatch a fix-rebase task with the conflict info.
 *
 * The motivation: without this, parallel agents can land overlapping
 * commits on main while a worktree branch is still implementing, and
 * the conflict only surfaces at human approve time. Surfacing it here
 * lets the agent (who has full context for the changes) resolve it.
 */
export async function rebaseWorktreeOntoBase(
  worktreePath: string,
  base: string,
): Promise<RebaseResult> {
  // 1. Find the upstream repo so we can fetch base if needed.
  let mergeBaseSha: string | null = null
  let baseHeadSha: string | null = null
  try {
    const { stdout: mb } = await execFileAsync(
      'git', ['-C', worktreePath, 'merge-base', 'HEAD', base],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    mergeBaseSha = mb.trim()
    const { stdout: bh } = await execFileAsync(
      'git', ['-C', worktreePath, 'rev-parse', base],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    baseHeadSha = bh.trim()
  } catch (error) {
    return {
      rebased: false,
      needed: false,
      output: `failed to read merge-base: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (mergeBaseSha === baseHeadSha) {
    // Already up to date — nothing to do.
    return { rebased: true, needed: false, output: '' }
  }

  // 2. Attempt the rebase.
  try {
    await execFileAsync(
      'git', ['-C', worktreePath, 'rebase', '--no-verify', base],
      { encoding: 'utf-8', timeout: 60_000 },
    )
    return { rebased: true, needed: true, output: '' }
  } catch (error) {
    const stderr = (error as { stderr?: string; stdout?: string }).stderr ?? ''
    const stdout = (error as { stderr?: string; stdout?: string }).stdout ?? ''
    // Always abort to leave the worktree clean.
    await execFileAsync(
      'git', ['-C', worktreePath, 'rebase', '--abort'],
      { encoding: 'utf-8', timeout: 10_000 },
    ).catch(() => undefined)
    return {
      rebased: false,
      needed: true,
      output: (stdout + '\n' + stderr).trim() || (error instanceof Error ? error.message : String(error)),
    }
  }
}

/**
 * Run verify commands in a worktree directory.
 * Returns pass/fail with captured output.
 */
export async function verifyWorktree(
  worktreePath: string,
  commands: string[],
): Promise<VerifyResult> {
  const outputs: string[] = []
  const env = verificationEnv()

  for (const cmd of commands) {
    try {
      log.info('verify', `running: ${cmd} (in ${worktreePath})`)
      const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', cmd], {
        cwd: worktreePath,
        env,
        encoding: 'utf-8',
        timeout: 180_000,
        // Real verify suites (e.g. `pnpm test`) emit well over the 1 MB execFile
        // default. Without a large buffer Node kills the child with
        // ERR_CHILD_PROCESS_STDIO_MAXBUFFER and a passing suite is misreported
        // as a verify failure.
        maxBuffer: 64 * 1024 * 1024,
      })
      outputs.push(`$ ${cmd}\n${(stdout + stderr).trim()}`)
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
      const captured = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
      const msg = captured !== '' ? captured : (error instanceof Error ? error.message : String(error))
      outputs.push(`$ ${cmd}\nFAILED: ${msg}`)
      log.warn('verify', `command failed: ${cmd}`)
      return { passed: false, output: outputs.join('\n\n') }
    }
  }

  log.info('verify', `all ${commands.length} commands passed`)
  return { passed: true, output: outputs.join('\n\n') }
}

function verificationEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.DUCTUM_OPERATOR_TOKEN
  return env
}

/**
 * Collect the git diff from a worktree for review.
 */
export async function collectDiff(worktreePath: string, baseBranch?: string): Promise<string> {
  try {
    const committedDiff = await collectCommittedBranchDiff(worktreePath, baseBranch)

    // Include both staged and unstaged changes
    const { stdout: untrackedFiles } = await execFileAsync(
      'git', ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard'],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    const { stdout: stagedDiff } = await execFileAsync(
      'git', ['-C', worktreePath, 'diff', '--cached', 'HEAD'],
      { encoding: 'utf-8', timeout: 30_000 },
    )
    const { stdout: trackedDiff } = await execFileAsync(
      'git', ['-C', worktreePath, 'diff', 'HEAD'],
      { encoding: 'utf-8', timeout: 30_000 },
    )

    // For untracked files, show their content
    let untrackedDiff = ''
    for (const file of untrackedFiles.trim().split('\n').filter(Boolean)) {
      try {
        const { stdout: content } = await execFileAsync(
          'git', ['-C', worktreePath, 'diff', '--no-index', '/dev/null', file],
          { encoding: 'utf-8', timeout: 10_000 },
        )
        untrackedDiff += content
      } catch (error) {
        // git diff --no-index exits 1 when files differ (expected)
        const err = error as NodeJS.ErrnoException & { stdout?: string }
        if (err.stdout) untrackedDiff += err.stdout
      }
    }

    const fullDiff = [committedDiff, stagedDiff, trackedDiff, untrackedDiff]
      .filter((part) => part.trim() !== '')
      .join('\n')
      .trim()
    if (fullDiff === '') return '(no changes detected)'

    // Truncate very large diffs
    const MAX_DIFF_CHARS = 50_000
    if (fullDiff.length > MAX_DIFF_CHARS) {
      return fullDiff.slice(0, MAX_DIFF_CHARS) + `\n\n... (truncated, ${fullDiff.length} chars total)`
    }
    return fullDiff
  } catch (error) {
    log.warn('verify', `failed to collect diff: ${error instanceof Error ? error.message : error}`)
    return '(failed to collect diff)'
  }
}

async function collectCommittedBranchDiff(worktreePath: string, baseBranch?: string): Promise<string> {
  if (baseBranch == null || baseBranch.trim() === '') return ''
  try {
    const { stdout: mergeBase } = await execFileAsync(
      'git', ['-C', worktreePath, 'merge-base', 'HEAD', baseBranch],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    const base = mergeBase.trim()
    if (base === '') return ''
    const { stdout } = await execFileAsync(
      'git', ['-C', worktreePath, 'diff', `${base}..HEAD`],
      { encoding: 'utf-8', timeout: 30_000 },
    )
    return stdout
  } catch (error) {
    log.warn('verify', `failed to collect committed diff: ${error instanceof Error ? error.message : error}`)
    return ''
  }
}

/**
 * Build the prompt for a review task.
 */
export function buildReviewPrompt(
  originalTask: Task,
  diff: string,
  verifyOutput: string,
): string {
  return [
    '## Review Task',
    '',
    'A different agent implemented the following task. Review their changes.',
    '',
    '### Original Task',
    originalTask.prompt,
    '',
    '### Verification Output (build + test)',
    '```',
    verifyOutput.slice(0, 10_000),
    '```',
    '',
    '### Diff',
    '```diff',
    diff,
    '```',
    '',
    '### Instructions',
    '',
    'Review the diff for:',
    '1. **Correctness** — does it solve the task as described?',
    '2. **Bugs** — logic errors, off-by-one, null handling, race conditions',
    '3. **Security** — injection, XSS, secrets exposure, unsafe operations',
    '4. **Quality** — readability, naming, unnecessary complexity',
    '',
    'Do not edit, push, approve, or merge. Reviews end only by calling `ductum_complete`.',
    '',
    '### REQUIRED VERDICT FORMAT (read carefully — malformed verdicts are rejected)',
    '',
    'Your `ductum_complete` result MUST end with a `## Final verdict` section that',
    'contains exactly ONE verdict line as its first non-empty content. The verdict',
    'line must match one of these forms exactly (no trailing prose on the same line):',
    '',
    '```',
    'PASS',
    'PASS: <one-line summary>',
    'WARN: <specific cleanup findings>',
    'FAIL: <specific blocking findings>',
    '```',
    '',
    'Template — copy this as the last section of your completion and replace `<verdict>`:',
    '',
    '```',
    '## Final verdict',
    '',
    '<verdict>',
    '```',
    '',
    'Rules:',
    '- Put any review notes ABOVE the `## Final verdict` heading, not below it. The',
    '  parser inspects the verdict-shaped line that immediately follows the heading.',
    '- A short post-verdict cleanup line (e.g., "Cleanup performed.") is tolerated',
    '  inside the `## Final verdict` section, but is not required and adds no signal.',
    '- If you do not include the `## Final verdict` heading, the parser also accepts',
    '  the verdict line as the FIRST non-empty line of your completion (Decision 123)',
    '  OR as the LAST non-empty line. Either anchor parses cleanly. Mid-prose',
    '  verdict mentions without an anchor are rejected as malformed and the review',
    '  is re-run.',
    '- If you lead with a verdict and later contradict it (e.g., "PASS: at first',
    '  glance" followed by "FAIL: actually broken"), the parse is rejected — emit',
    '  exactly one verdict word.',
    '- Use exactly one verdict. PASS is the only clean result. Do not pick PASS just',
    '  to close the loop — pick WARN or FAIL when there are findings.',
    '- WARN and FAIL both send the original agent back through the fix loop, so be',
    '  specific about what needs fixing.',
    '- A bare `PASS` (no colon, no feedback) is accepted but discouraged. Prefer',
    '  `PASS: <one-line summary>`.',
  ].join('\n')
}

/**
 * Build the prompt for a fix task created when a rebase onto base
 * fails. Gives the agent the conflict output from `git rebase` so it
 * can resolve the conflicts in the same worktree it just worked in.
 */
export function buildRebaseFixPrompt(
  originalTask: Task,
  base: string,
  rebaseOutput: string,
): string {
  return [
    '## Rebase Conflict Resolution',
    '',
    'A parallel agent landed overlapping commits on `' + base + '` while you were implementing this task. We tried to rebase your worktree onto the new tip of `' + base + '` and hit conflicts. You need to resolve them.',
    '',
    '### Original Task',
    originalTask.prompt,
    '',
    '### Rebase Output',
    '```',
    rebaseOutput.slice(0, 8_000),
    '```',
    '',
    '### Instructions',
    '',
    '1. Run `git status` to see which files are conflicted.',
    '2. For each conflicted file, edit it to merge the parallel changes with your own. Preserve both intents — yours AND the upstream change.',
    '3. Stage the resolved files with `git add`.',
    '4. Run `git rebase --continue`.',
    '5. Re-run the verify commands to make sure everything still works.',
    '6. Call `ductum_complete` with a description of how you resolved each conflict.',
    '',
    'Do not push branches or merge. Ductum owns shipping after you complete.',
    '',
    'Do NOT abort the rebase or revert your changes. The point is to combine your work with the parallel changes.',
  ].join('\n')
}

/**
 * Build the prompt for a fix task (after review failure).
 */
export function buildFixPrompt(
  originalTask: Task,
  reviewFeedback: string,
  roundNumber: number,
  verdict: Exclude<CodeReviewVerdict, 'pass'> = 'fail',
): string {
  const isWarning = verdict === 'warn'
  return [
    '## ' + (isWarning ? 'Warning Cleanup Task' : 'Fix Task') + ' (Review Round ' + roundNumber + ')',
    '',
    '### Original Task',
    originalTask.prompt,
    '',
    '### Review Feedback',
    isWarning
      ? 'A reviewer left warning findings that still need cleanup before this is green:'
      : 'A reviewer found blocking issues with your previous implementation:',
    '',
    reviewFeedback,
    '',
    '### Instructions',
    '',
    isWarning
      ? 'Clean up the specific warning findings above. Do not rewrite from scratch.'
      : 'Fix the specific issues identified above. Do not rewrite from scratch.',
    'Do not push branches or merge. Ductum owns shipping after you complete.',
    'When done, call `ductum_complete` with a description of what you fixed.',
  ].join('\n')
}

/**
 * Human-readable description of the verdict format the reviewer must
 * follow. Used both in the malformed-review feedback and as a constant
 * the prompt and tests assert against so the prompt and parser stay in
 * lockstep.
 */
export const REVIEW_VERDICT_FORMAT_RULE =
  'End your completion with a `## Final verdict` section whose first ' +
  'non-empty content line is exactly PASS, WARN, or FAIL (optionally ' +
  'followed by ": <feedback>"). Without that section, the parser also ' +
  'accepts the verdict as the FIRST non-empty line OR the LAST non-empty ' +
  'line of your completion. Mentioning a verdict word inside prose ' +
  'without satisfying any of those anchors — or contradicting yourself ' +
  'with a different verdict word elsewhere — is rejected as malformed.'

/**
 * Match a single line that is a verdict. Only PASS / WARN / FAIL are
 * accepted, optionally followed by `:` and feedback. Anchored so prose
 * around the verdict word on the same line is not accepted as a verdict.
 */
const TERMINAL_VERDICT_LINE = /^(PASS|WARN|FAIL)(?::\s*(.*))?\s*$/i

/**
 * Heading that, when present near the end of the completion, lets the
 * parser accept a verdict-shaped line as the section's first non-empty
 * content even if subsequent prose follows. Matches `## Final verdict`,
 * `### Final Verdict`, optional trailing punctuation, case-insensitive.
 */
const FINAL_VERDICT_HEADING = /^#{1,6}\s*final\s+verdict\b[:.]*\s*$/i

interface VerdictMatch {
  /** Index in `lines` of the verdict line that produced the match. */
  lineIdx: number
  /** Lowercased verdict word (`pass` / `warn` / `fail`). */
  verdict: CodeReviewVerdict
  /** Trailing feedback on the same line as the verdict (e.g. "looks good"). */
  tail: string
  /** Heading the verdict was anchored to, if any (used for feedback assembly). */
  headingIdx?: number
}

/**
 * Parse a review result from the agent's completion message.
 *
 * Three acceptance paths, in priority order:
 *
 * 1. **Pre-filled section path (Decision 116).** If the completion
 *    contains a `## Final verdict` heading, the parser reads the FIRST
 *    verdict-shaped line that immediately follows it (allowing blank
 *    spacer lines). Tolerates short trailing prose inside the section
 *    so reviewers who add a follow-up note ("Cleanup performed.") still
 *    parse on first try. This is the path the prompt instructs every
 *    reviewer to take.
 *
 * 2. **Strict terminal-line fallback (Decision 060).** When no
 *    `## Final verdict` heading is present, the LAST non-empty line of
 *    the trimmed completion must itself be a verdict-shaped line. This
 *    closes the operator-flow attack where a reviewer writes
 *    `PASS: at first glance` and then walks the verdict back in prose.
 *
 * 3. **Leading-verdict path (Decision 123, P3.3).** When neither anchor
 *    is found, the FIRST non-empty line is checked. If it is a clean
 *    verdict-shaped line (`PASS` / `PASS: ...` / `WARN: ...` /
 *    `FAIL: ...`), the parser accepts it BUT only after scanning the
 *    rest of the completion for any other verdict-shaped line. If any
 *    later line carries a DIFFERENT verdict word, the parse is
 *    rejected as malformed (the operator-flow downgrade attack). This
 *    is the path that lets Codex's prose-mixed natural style parse on
 *    first try without loosening into mid-sentence verdict mentions.
 *
 * Returns `{ malformed: true, verdict: 'fail', passed: false, feedback }`
 * for any other shape — empty input, prose without any anchor, or
 * mid-sentence verdict mentions.
 */
export function parseReviewResult(completionResult: string): CodeReviewResult {
  const trimmed = completionResult.trim()
  if (trimmed === '') {
    return malformedResult('empty result', null)
  }

  const lines = trimmed.split(/\r?\n/)
  const headingMatch = locateVerdictUnderHeading(lines)
  if (headingMatch != null) {
    return acceptVerdictMatch(lines, headingMatch)
  }

  const terminalMatch = locateTerminalVerdict(lines)
  if (terminalMatch != null) {
    return acceptVerdictMatch(lines, terminalMatch)
  }

  const leadingMatch = locateLeadingVerdict(lines)
  if (leadingMatch != null) {
    return acceptLeadingVerdictMatch(lines, leadingMatch)
  }

  return malformedResult('terminal line was not a verdict', trimmed)
}

function locateVerdictUnderHeading(lines: string[]): VerdictMatch | null {
  // Walk from the end so the LAST `## Final verdict` heading wins when
  // a reviewer accidentally writes the heading twice. The first
  // verdict-shaped line after that heading is the verdict.
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = (lines[i] ?? '').trim()
    if (!FINAL_VERDICT_HEADING.test(candidate)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? '').trim()
      if (next === '') continue
      const m = TERMINAL_VERDICT_LINE.exec(next)
      if (m == null) {
        // Section opened with prose before the verdict — treat as
        // "no heading match" so the strict terminal-line fallback runs.
        return null
      }
      return {
        lineIdx: j,
        verdict: (m[1] ?? '').toLowerCase() as CodeReviewVerdict,
        tail: m[2]?.trim() ?? '',
        headingIdx: i,
      }
    }
    // Heading with no following content — no verdict to anchor to.
    return null
  }
  return null
}

function locateTerminalVerdict(lines: string[]): VerdictMatch | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = (lines[i] ?? '').trim()
    if (candidate === '') continue
    const m = TERMINAL_VERDICT_LINE.exec(candidate)
    if (m == null) return null
    return {
      lineIdx: i,
      verdict: (m[1] ?? '').toLowerCase() as CodeReviewVerdict,
      tail: m[2]?.trim() ?? '',
    }
  }
  return null
}

function acceptVerdictMatch(lines: string[], match: VerdictMatch): CodeReviewResult {
  const bodyEnd = match.headingIdx ?? match.lineIdx
  const body = lines.slice(0, bodyEnd).join('\n').trim()
  const feedback = [body, match.tail].filter((part) => part !== '').join('\n\n').trim()
  return {
    verdict: match.verdict,
    passed: match.verdict === 'pass',
    feedback,
  }
}

/**
 * Locate a verdict line that appears as the FIRST non-empty content of
 * the completion. Returns `null` when:
 *
 *   - the first non-empty line is not verdict-shaped (so falls through
 *     to malformed), OR
 *   - the first line is verdict-shaped but a LATER verdict-shaped line
 *     carries a different verdict word (the downgrade attack — the
 *     reviewer wrote "PASS: at first glance" then "FAIL: actually
 *     broken" later. Refusing the parse forces a re-run instead of
 *     silently picking either verdict).
 *
 * Decision 123 / P3.3.
 */
function locateLeadingVerdict(lines: string[]): VerdictMatch | null {
  for (let i = 0; i < lines.length; i++) {
    const candidate = (lines[i] ?? '').trim()
    if (candidate === '') continue
    const m = TERMINAL_VERDICT_LINE.exec(candidate)
    if (m == null) return null
    const leadingVerdict = (m[1] ?? '').toLowerCase() as CodeReviewVerdict

    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? '').trim()
      if (next === '') continue
      const nm = TERMINAL_VERDICT_LINE.exec(next)
      if (nm == null) continue
      const otherVerdict = (nm[1] ?? '').toLowerCase()
      if (otherVerdict !== leadingVerdict) return null
    }

    return {
      lineIdx: i,
      verdict: leadingVerdict,
      tail: m[2]?.trim() ?? '',
    }
  }
  return null
}

function acceptLeadingVerdictMatch(
  lines: string[],
  match: VerdictMatch,
): CodeReviewResult {
  // For leading-verdict matches, the body lives AFTER the verdict line
  // (the reviewer led with the verdict and then explained their
  // reasoning). Stitch the trailing prose into the feedback so the
  // failure path still includes the reviewer's findings.
  const after = lines.slice(match.lineIdx + 1).join('\n').trim()
  const feedback = [match.tail, after].filter((part) => part !== '').join('\n\n').trim()
  return {
    verdict: match.verdict,
    passed: match.verdict === 'pass',
    feedback,
  }
}

function malformedResult(detail: string, includeRaw: string | null): CodeReviewResult {
  const raw = includeRaw != null ? '\n\nReviewer output:\n' + includeRaw : ''
  return {
    verdict: 'fail',
    passed: false,
    feedback: 'Malformed reviewer completion: ' + detail + '. ' + REVIEW_VERDICT_FORMAT_RULE + raw,
    malformed: true,
  }
}
