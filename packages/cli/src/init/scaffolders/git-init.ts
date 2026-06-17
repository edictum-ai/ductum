import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { ProcessResult, RunProcess } from '../../runtime.js'
import { initCancelledError } from '../errors.js'

const execFileAsync = promisify(execFile)
type RunProcessOptions = NonNullable<Parameters<RunProcess>[2]>

export async function initGit(
  projectDir: string,
  runProcess: RunProcess,
  signal?: AbortSignal,
): Promise<void> {
  await requireOk(runGit(runProcess, ['-C', projectDir, 'init'], signal), signal)
  await requireOk(runGit(runProcess, ['-C', projectDir, 'add', '.gitignore'], signal), signal)
  const authorArgs = await hasConfiguredAuthor(projectDir, runProcess, signal)
    ? []
    : ['-c', 'user.name=Ductum', '-c', 'user.email=ductum@example.invalid']
  await requireOk(runGit(runProcess, [
    '-C',
    projectDir,
    ...authorArgs,
    'commit',
    '-m',
    'chore: initialize ductum factory',
  ], signal), signal)
}

export async function defaultRunProcess(
  command: string,
  args: string[] = [],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      env: options.env,
      signal: options.signal,
      timeout: options.timeoutMs ?? 10_000,
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string; message?: string; name?: string }
    const aborted = options.signal?.aborted === true || err.name === 'AbortError' || err.code === 'ABORT_ERR'
    return {
      code: aborted ? 130 : typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: aborted ? 'aborted' : err.stderr ?? err.message ?? '',
    }
  }
}

async function hasConfiguredAuthor(projectDir: string, runProcess: RunProcess, signal?: AbortSignal): Promise<boolean> {
  checkAbort(signal)
  const [name, email] = await Promise.all([
    runGit(runProcess, ['-C', projectDir, 'config', 'user.name'], signal),
    runGit(runProcess, ['-C', projectDir, 'config', 'user.email'], signal),
  ])
  checkAbort(signal)
  return name.code === 0 && email.code === 0 && name.stdout.trim() !== '' && email.stdout.trim() !== ''
}

function runGit(runProcess: RunProcess, args: string[], signal?: AbortSignal): Promise<ProcessResult> {
  const options = processOptions(signal)
  return options == null ? runProcess('git', args) : runProcess('git', args, options)
}

async function requireOk(resultPromise: Promise<ProcessResult>, signal?: AbortSignal): Promise<void> {
  const result = await resultPromise
  checkAbort(signal)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'command failed')
  }
}

function processOptions(signal: AbortSignal | undefined): RunProcessOptions | undefined {
  return signal == null ? undefined : { signal }
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw initCancelledError()
}
