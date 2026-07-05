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
  if (ahead > 0) return
  throw new ValidationError(
    `${input.label} has no commits ahead of ${input.baseLabel ?? input.base}; refusing to ship empty work`,
  )
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

async function runGit(input: AssertHeadAheadInput, args: string[]): Promise<{ stdout: string }> {
  if (input.runGit != null) return await input.runGit(args)
  return await execFileAsync('git', args, { encoding: 'utf-8', timeout: 10_000 })
}
