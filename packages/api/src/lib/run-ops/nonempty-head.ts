import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ValidationError } from '../errors.js'

const execFileAsync = promisify(execFile)

export type GitRunner = (args: string[]) => Promise<{ stdout: string }>

export interface AssertHeadAheadInput {
  repoPath: string
  base: string
  head: string
  label: string
  baseLabel?: string
  runGit?: GitRunner
}

export async function assertHeadHasCommitsAheadOfBase(input: AssertHeadAheadInput): Promise<void> {
  const ahead = await countCommitsAhead(input)
  if (ahead === 0) {
    throw new ValidationError(
      `${input.label} has no commits ahead of ${input.baseLabel ?? input.base}; refusing to ship empty work`,
    )
  }
  if (await hasEmptyTreeDiff(input)) {
    throw new ValidationError(
      `${input.label} has ${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${input.baseLabel ?? input.base} but the net tree diff is empty; refusing to ship no-op work`,
    )
  }
}

async function countCommitsAhead(input: AssertHeadAheadInput): Promise<number> {
  const spec = `${input.base}..${input.head}`
  try {
    const { stdout } = await runGit(input, ['-C', input.repoPath, 'rev-list', '--count', spec])
    const value = Number(stdout.trim())
    if (Number.isFinite(value) && value >= 0) return value
  } catch (error) {
    throw new ValidationError(
      `Could not verify ${input.label} has commits ahead of ${input.baseLabel ?? input.base}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  throw new ValidationError(`Could not verify ${input.label} has commits ahead of ${input.baseLabel ?? input.base}`)
}

async function hasEmptyTreeDiff(input: AssertHeadAheadInput): Promise<boolean> {
  try {
    const { stdout } = await runGit(input, ['-C', input.repoPath, 'diff', '--shortstat', `${input.base}...${input.head}`])
    return stdout.trim() === ''
  } catch (error) {
    throw new ValidationError(
      `Could not verify ${input.label} has a non-empty tree diff against ${input.baseLabel ?? input.base}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function runGit(input: AssertHeadAheadInput, args: string[]): Promise<{ stdout: string }> {
  if (input.runGit != null) return await input.runGit(args)
  return await execFileAsync('git', args, { encoding: 'utf-8', timeout: 10_000 })
}
