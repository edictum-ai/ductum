/**
 * Auto-commit helper for worktrees left dirty by an agent.
 *
 * Background: the Codex SDK harness occasionally leaves a worktree with
 * uncommitted (and even untracked) files when an agent finishes. The
 * downstream rebase/verify/merge steps all require a clean worktree, so
 * the run dies at merge time with "worktree has uncommitted changes" and
 * the human has to babysit it.
 *
 * The post-completion router calls into this BEFORE rebase/verify so a
 * dirty worktree gets a synthetic commit attributed to the agent rather
 * than blocking the pipeline. The commit message records that this was
 * a synthetic commit so it's distinguishable from the agent's own
 * commits in `git log`.
 *
 * Returns:
 *   - { committed: false, dirty: false } when the worktree was already clean.
 *   - { committed: true, dirty: true, sha } when a synthetic commit was created.
 *   - { committed: false, dirty: true, error } when staging or commit failed.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { sanitizeGeneratedGitTitle } from './generated-git-title.js'
import { checkPublicGitMetadata } from './public-git-metadata-gate.js'

const execFileAsync = promisify(execFile)

export interface AutoCommitResult {
  /** Did the worktree have any uncommitted/untracked changes? */
  dirty: boolean
  /** Did this helper actually create a commit? */
  committed: boolean
  /** SHA of the synthetic commit when one was created. */
  sha?: string
  /** Captured error output when something failed. */
  error?: string
}

const COMMIT_AUTHOR_NAME = 'ductum-auto-commit'
const COMMIT_AUTHOR_EMAIL = 'auto-commit@ductum.local'

/**
 * Inspect a worktree for any uncommitted changes (tracked or untracked,
 * staged or unstaged) and create a single synthetic commit covering all
 * of them when found. The commit message embeds `taskName` so the human
 * can trace it back to the run that left files behind.
 *
 * Safe to call when the worktree is already clean — it short-circuits
 * before touching git in that case.
 */
export async function autoCommitWorktree(
  worktreePath: string,
  taskName: string,
): Promise<AutoCommitResult> {
  // 0. Short-circuit synchronously if the path is missing or isn't a
  //    directory. This handles the common race where the worktree was
  //    already removed between session-end and post-completion (e.g.
  //    user approved a sibling run that shared the worktree, or test
  //    fixtures using fake paths). Returning early avoids spawning a
  //    git subprocess on a path that can't possibly resolve.
  try {
    const stat = fs.statSync(worktreePath)
    if (!stat.isDirectory()) {
      return { dirty: false, committed: false, error: 'worktree path is not a directory' }
    }
  } catch {
    return { dirty: false, committed: false, error: 'worktree path does not exist' }
  }

  // 1. Detect dirty state via porcelain status. Anything non-empty means
  //    we have something to commit (modified, deleted, untracked, staged).
  let status: string
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'status', '--porcelain'],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    status = stdout
  } catch (error) {
    return {
      dirty: false,
      committed: false,
      error: `git status failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (status.trim() === '') {
    return { dirty: false, committed: false }
  }

  // 2. Stage everything (tracked, untracked, deleted).
  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'add', '-A'],
      { encoding: 'utf-8', timeout: 30_000 },
    )
  } catch (error) {
    return {
      dirty: true,
      committed: false,
      error: `git add -A failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // 3. Commit with a fixed author so it's recognizable in git log. The
  //    -c flags scope the override to this single command so it doesn't
  //    leak into the worktree's local config. The subject is a descriptive
  //    conventional title (no `auto-commit`/`finalize`/planning labels);
  //    synthetic provenance lives in the body and author so `git log`
  //    can still distinguish this synthetic commit from the agent's own.
  //    The public-metadata gate fails closed on the task-derived subject
  //    (e.g. when sanitization left a placeholder like `task`); we fall
  //    back to the bare subject so the synthetic commit still lands and
  //    the post-completion pipeline keeps moving. The pipeline-level
  //    gate (syncGitHubShipArtifacts) is the hard fail-closed point.
  const subjectContext = sanitizeGeneratedGitTitle(taskName)
  // The sanitizer folds fully-stripped task names to the placeholder
  // 'task'. When that happens, the scoped subject would carry synthetic
  // metadata-only text; fall back to the bare subject so the commit
  // stays descriptive. An empty subject context (whitespace/empty input)
  // also falls back to the bare subject.
  const sanitizedToPlaceholder = subjectContext === '' || subjectContext === 'task'
  const taskScopedSubject = sanitizedToPlaceholder
    ? null
    : `chore(worktree): save uncommitted files for ${subjectContext}`
  const subject = taskScopedSubject != null && checkPublicGitMetadata(taskScopedSubject).ok
    ? taskScopedSubject
    : 'chore(worktree): save uncommitted files'
  const message = `${subject}\n\nThis synthetic commit was created by ductum's auto-commit helper\nbecause the agent left uncommitted files in the worktree at the end\nof its session. The post-completion pipeline requires a clean\nworktree before rebase/verify/merge.\n`
  try {
    await execFileAsync(
      'git',
      [
        '-C', worktreePath,
        '-c', `user.name=${COMMIT_AUTHOR_NAME}`,
        '-c', `user.email=${COMMIT_AUTHOR_EMAIL}`,
        '-c', 'commit.gpgsign=false',
        '-c', 'tag.gpgsign=false',
        'commit',
        '--no-verify',
        '--allow-empty',
        '-m', message,
      ],
      { encoding: 'utf-8', timeout: 30_000 },
    )
  } catch (error) {
    return {
      dirty: true,
      committed: false,
      error: `git commit failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // 4. Read back the SHA so callers can log it.
  let sha: string | undefined
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-parse', 'HEAD'],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    sha = stdout.trim()
  } catch {
    // Non-fatal — we still committed successfully.
  }

  return { dirty: true, committed: true, sha }
}
