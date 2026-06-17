import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { NotFoundError } from '../errors.js'
import { requireRun } from './common.js'

const execFileAsync = promisify(execFile)
const MAX_DIFF_BYTES = 200_000

export interface RunDiffFile {
  path: string
  insertions: number
  deletions: number
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

  const base = options.base ?? 'main'
  const diffRange = `${base}...HEAD`
  let numstatStdout = ''
  try {
    const result = await execFileAsync(
      'git',
      ['-C', worktreePath, 'diff', '--numstat', diffRange],
      { encoding: 'utf-8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    )
    numstatStdout = result.stdout
  } catch (error) {
    throw new NotFoundError(
      `Failed to compute diff for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const files: RunDiffFile[] = []
  for (const line of numstatStdout.split('\n')) {
    if (line.trim() === '') continue
    const [insStr, delStr, ...pathParts] = line.split('\t')
    const path = pathParts.join('\t')
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
  let truncated = false
  try {
    const result = await execFileAsync(
      'git',
      ['-C', worktreePath, 'diff', diffRange],
      { encoding: 'utf-8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    )
    diff = result.stdout
  } catch (error) {
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
