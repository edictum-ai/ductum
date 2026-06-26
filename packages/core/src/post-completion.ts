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
import { isGitHubIssuePromptSource } from './work-item-source.js'
import { buildReviewedCommitSection } from './post-completion-review-metadata.js'
import { parseStructuredReviewContract, STRUCTURED_REVIEW_CONTRACT_RULE } from './structured-review-contract.js'
import type { AgentId, Run, RunId, RunWorkflowProfileSnapshot, Task } from './types.js'

const execFileAsync = promisify(execFile)

export interface VerifyResult {
  passed: boolean
  output: string
  commands?: VerifyCommandResult[]
}

export interface VerifyCommandResult {
  command: string
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
  onReviewResult?: (runId: RunId, result: CodeReviewResult, commitSha?: string) => Promise<void> | void
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
  const commandResults: VerifyCommandResult[] = []
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
      const output = `$ ${cmd}\n${(stdout + stderr).trim()}`
      outputs.push(output)
      commandResults.push({ command: cmd, passed: true, output })
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
      const captured = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
      const msg = captured !== '' ? captured : (error instanceof Error ? error.message : String(error))
      const output = `$ ${cmd}\nFAILED: ${msg}`
      outputs.push(output)
      commandResults.push({ command: cmd, passed: false, output })
      log.warn('verify', `command failed: ${cmd}`)
      return { passed: false, output: outputs.join('\n\n'), commands: commandResults }
    }
  }

  log.info('verify', `all ${commands.length} commands passed`)
  return { passed: true, output: outputs.join('\n\n'), commands: commandResults }
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
  reviewedCommitSha?: string,
  importedReviewPrompt?: string,
): string {
  return [
    '## Review Task',
    '',
    'A different agent implemented the following task. Review their changes.',
    '',
    ...buildReviewedCommitSection(reviewedCommitSha),
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
    ...(importedReviewPrompt == null ? [] : [
      '',
      '### Imported Review Prompt',
      importedReviewPrompt,
    ]),
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
    '### REQUIRED STRUCTURED VERDICT CONTRACT (malformed output is rejected)',
    '',
    'Your `ductum_complete` result MUST include exactly one JSON object matching this contract:',
    '```json',
    STRUCTURED_REVIEW_CONTRACT_RULE,
    '```',
    '',
    'Rules:',
    '- Do not emit prose-only PASS/WARN/FAIL. Legacy textual verdicts are malformed.',
    '- Use verdict=pass only when the implementation is clean.',
    '- Use verdict=warn or verdict=fail with specific findings when fixes are needed.',
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
export const REVIEW_VERDICT_FORMAT_RULE = STRUCTURED_REVIEW_CONTRACT_RULE

/**
 * Parse a review result from the agent's completion message.
 *
 * The only accepted shape is one `ductum-review-result` JSON object
 * matching STRUCTURED_REVIEW_CONTRACT_RULE. Legacy prose-only
 * PASS/WARN/FAIL completions are intentionally malformed.
 *
 * Returns `{ malformed: true, verdict: 'fail', passed: false, feedback }`
 * for empty input, invalid JSON, duplicate contracts, and legacy prose
 * verdicts.
 */
export function parseReviewResult(completionResult: string): CodeReviewResult {
  const parsed = parseStructuredReviewContract(completionResult)
  if (parsed.contract == null) return malformedResult(parsed.reason ?? 'malformed structured review contract', completionResult.trim() || null)
  const contract = parsed.contract
  const feedback = [contract.summary, ...contract.findings].filter((part) => part.trim() !== '').join('\n')
  return { verdict: contract.verdict, passed: contract.verdict === 'pass', feedback }
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

export function getImportedReviewPrompt(task: Task): string | null {
  return isGitHubIssuePromptSource(task.source) ? task.source.promptImport.review.body : null
}
