import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { NotFoundError, ValidationError } from '../errors.js'
import { requireRun } from './common.js'

const execFileAsync = promisify(execFile)
const MAX_DIFF_BYTES = 200_000
const GIT_BUFFER_BYTES = 8 * 1024 * 1024
const MAX_UNTRACKED_DIFF_BYTES = 100_000
const MAX_UNTRACKED_DIFF_FILES = 10
const UNTRACKED_GIT_TIMEOUT_MS = 1_000
const UNTRACKED_LIST_TIMEOUT_MS = 2_000
const UNTRACKED_LIST_BUFFER_BYTES = 128 * 1024
const UNTRACKED_NUMSTAT_BUFFER_BYTES = 1 * 1024 * 1024
const SAFE_BASE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/

interface UntrackedPathList { paths: string[]; omitted: number | null; truncated: boolean }

export interface RunDiffFile {
  path: string; insertions: number; deletions: number
  status: 'text' | 'binary'
}

export interface RunDiffResult {
  diff: string
  files: RunDiffFile[]
  totals: { files: number; insertions: number; deletions: number }
  base: string
  truncated: boolean
}

export async function getRunDiff(
  context: ApiContext,
  runId: RunId,
  options: { base?: string } = {},
): Promise<RunDiffResult> {
  const run = requireRun(context, runId)
  const worktreePath = run.worktreePaths?.[0]
  if (worktreePath == null || worktreePath === '') {
    throw new NotFoundError(`Run ${runId} has no worktree — nothing to diff`)
  }

  const base = normalizeDiffBase(options.base ?? 'main')
  const diffBase = await resolveDiffBase(worktreePath, base)
  let untrackedPaths: UntrackedPathList = { paths: [], omitted: 0, truncated: false }
  let untrackedWarning: string | null = null
  let numstatStdout = ''
  try {
    numstatStdout = await runGit(worktreePath, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', diffBase], 15_000)
  } catch (error) {
    throw new NotFoundError(
      `Failed to compute diff for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    untrackedPaths = await listUntrackedPaths(worktreePath)
    numstatStdout = [
      numstatStdout,
      await collectUntrackedNumstat(worktreePath, untrackedPaths.paths),
    ].filter(Boolean).join('\n')
  } catch (error) {
    untrackedWarning = formatUntrackedWarning(error)
  }

  const files: RunDiffFile[] = []
  for (const line of numstatStdout.split('\n')) {
    if (line.trim() === '') continue
    const [insStr, delStr, ...pathParts] = line.split('\t')
    const path = normalizeNumstatPath(pathParts.join('\t'))
    if (path === '') continue
    const isBinary = insStr === '-' && delStr === '-'
    files.push({
      path,
      insertions: isBinary ? 0 : Number(insStr) || 0,
      deletions: isBinary ? 0 : Number(delStr) || 0,
      status: isBinary ? 'binary' : 'text',
    })
  }

  let diff = ''
  let truncated = untrackedPaths.truncated || untrackedWarning != null
  try {
    let untrackedOutput = ''
    if (untrackedWarning == null) {
      try {
        const untrackedDiff = await collectUntrackedDiffText(worktreePath, untrackedPaths.paths, untrackedPaths.omitted)
        truncated = truncated || untrackedDiff.truncated
        untrackedOutput = untrackedDiff.output
      } catch (error) {
        truncated = true
        untrackedWarning = formatUntrackedWarning(error)
      }
    }
    diff = [
      await runGit(worktreePath, ['diff', '--no-ext-diff', '--no-textconv', diffBase], 30_000),
      untrackedOutput,
      untrackedWarning,
    ].filter(Boolean).join('\n')
  } catch (error) {
    truncated = true
    diff = `(failed to collect diff text: ${error instanceof Error ? error.message : String(error)})`
  }

  if (diff.length > MAX_DIFF_BYTES) {
    diff = `${diff.slice(0, MAX_DIFF_BYTES)}\n\n... (truncated at ${MAX_DIFF_BYTES} bytes of ${diff.length})`
    truncated = true
  }

  const totals = files.reduce(
    (acc, f) => ({
      files: acc.files + 1,
      insertions: acc.insertions + f.insertions,
      deletions: acc.deletions + f.deletions,
    }),
    { files: 0, insertions: 0, deletions: 0 },
  )

  return { diff, files, totals, base, truncated }
}

async function resolveDiffBase(worktreePath: string, base: string): Promise<string> {
  let baseCommit = ''
  try {
    baseCommit = (await runGit(worktreePath, ['rev-parse', '--verify', `${base}^{commit}`], 15_000)).trim()
  } catch (error) {
    throw new NotFoundError(
      `Diff base not found: ${base}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    const stdout = await runGit(worktreePath, ['merge-base', baseCommit, 'HEAD'], 15_000)
    return stdout.trim() || baseCommit
  } catch (error) {
    throw new NotFoundError(
      `Diff base is not related to HEAD: ${base}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function collectUntrackedNumstat(worktreePath: string, paths: string[]): Promise<string> {
  const chunks: string[] = []
  for (const path of paths) {
    chunks.push(await runGitAllowDiffExit(
      worktreePath,
      ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '--no-index', '--', '/dev/null', path],
      UNTRACKED_GIT_TIMEOUT_MS,
      UNTRACKED_NUMSTAT_BUFFER_BYTES,
    ))
  }
  return chunks.filter(Boolean).join('\n')
}

async function collectUntrackedDiffText(
  worktreePath: string,
  paths: string[],
  omittedFiles: number | null,
): Promise<{ output: string; truncated: boolean }> {
  const chunks: string[] = []
  let bytes = 0
  let truncated = omittedFiles !== 0
  for (const path of paths) {
    if (bytes >= MAX_UNTRACKED_DIFF_BYTES) {
      truncated = true
      break
    }
    const remaining = MAX_UNTRACKED_DIFF_BYTES - bytes
    const result = await runGitAllowDiffExit(
      worktreePath,
      ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', path],
      UNTRACKED_GIT_TIMEOUT_MS,
      Math.max(64 * 1024, Math.min(GIT_BUFFER_BYTES, remaining + 16 * 1024)),
    )
    const next = result.slice(0, remaining)
    chunks.push(next)
    bytes += next.length
    if (result.length > next.length) {
      truncated = true
      break
    }
  }
  if (truncated) {
    const omitted = omittedFiles == null
      ? '; additional untracked file(s) omitted'
      : omittedFiles > 0 ? `; ${omittedFiles} untracked file(s) omitted` : ''
    chunks.push(`\n... (untracked diff truncated at ${MAX_UNTRACKED_DIFF_BYTES} bytes${omitted})`)
  }
  return { output: chunks.filter(Boolean).join('\n'), truncated }
}

async function listUntrackedPaths(worktreePath: string): Promise<UntrackedPathList> {
  const result = await runGitMaybePartial(
    worktreePath,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    UNTRACKED_LIST_TIMEOUT_MS,
    UNTRACKED_LIST_BUFFER_BYTES,
  )
  const parts = result.stdout.split('\0')
  const completeParts = result.truncated && !result.stdout.endsWith('\0') ? parts.slice(0, -1) : parts
  const paths = completeParts.filter((path) => path.trim() !== '')
  const selected = paths.slice(0, MAX_UNTRACKED_DIFF_FILES)
  const knownOmitted = Math.max(0, paths.length - selected.length)
  return {
    paths: selected,
    omitted: result.truncated ? null : knownOmitted,
    truncated: result.truncated || paths.length > selected.length,
  }
}

async function runGit(
  worktreePath: string,
  args: string[],
  timeout: number,
  maxBuffer: number = GIT_BUFFER_BYTES,
): Promise<string> {
  const result = await execFileAsync('git', ['-C', worktreePath, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
    encoding: 'utf-8',
    timeout,
    maxBuffer,
  })
  return result.stdout
}

async function runGitAllowDiffExit(
  worktreePath: string,
  args: string[],
  timeout: number,
  maxBuffer: number = GIT_BUFFER_BYTES,
): Promise<string> {
  try {
    return await runGit(worktreePath, args, timeout, maxBuffer)
  } catch (error) {
    if (isExpectedDiffExit(error) || isMaxBufferOutput(error)) return error.stdout
    throw error
  }
}

async function runGitMaybePartial(
  worktreePath: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
): Promise<{ stdout: string; truncated: boolean }> {
  try {
    return { stdout: await runGit(worktreePath, args, timeout, maxBuffer), truncated: false }
  } catch (error) {
    if (isMaxBufferOutput(error)) return { stdout: error.stdout, truncated: true }
    throw error
  }
}

function isExpectedDiffExit(error: unknown): error is { stdout: string } {
  return typeof error === 'object'
    && error != null
    && 'code' in error
    && ((error as { code?: unknown }).code === 1 || (error as { code?: unknown }).code === '1')
    && 'stdout' in error
    && typeof (error as { stdout?: unknown }).stdout === 'string'
}

function isMaxBufferOutput(error: unknown): error is { stdout: string } {
  return typeof error === 'object'
    && error != null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    && 'stdout' in error
    && typeof (error as { stdout?: unknown }).stdout === 'string'
}

function normalizeNumstatPath(path: string): string {
  const noIndexCreatePrefix = '/dev/null => '
  if (path.startsWith(noIndexCreatePrefix)) return path.slice(noIndexCreatePrefix.length)
  return path
}

function formatUntrackedWarning(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `... (untracked diff unavailable: ${message})`
}

function normalizeDiffBase(base: string): string {
  const trimmed = base.trim()
  if (
    trimmed === ''
    || trimmed.startsWith('-')
    || trimmed.includes('..')
    || trimmed.includes('@{')
    || trimmed.includes('//')
    || trimmed.endsWith('/')
    || trimmed.includes('\\')
    || !SAFE_BASE_REF_PATTERN.test(trimmed)
  ) {
    throw new ValidationError(`Invalid diff base: ${base}`)
  }
  return trimmed
}
