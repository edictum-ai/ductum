import * as p from '@clack/prompts'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { initDb, seedInitialFactoryDatabase, type InitialFactorySeedResult } from '@ductum/core'

import type { CliContext } from '../../runtime.js'
import type { RunProcess } from '../../runtime.js'
import { initCancelledError } from '../errors.js'
import { factoryGitignore } from '../scaffolders/factory-gitignore.js'
import { defaultRunProcess, initGit } from '../scaffolders/git-init.js'
import { assertInitTargetValidation, validateInitTarget, type InitTargetValidation } from '../paths.js'
import type { InitAgentProvider } from './agent-pickers.js'
import { writeFactorySecretKey } from './secret-key.js'

export interface ScaffoldInput {
  projectDir: string
  projectName: string
  git: boolean
  runProcess?: RunProcess
  signal?: AbortSignal
  validation?: InitTargetValidation
  hooks?: { afterMkdir?: () => void }
  claudeAgent?: boolean
  agents?: InitAgentProvider[]
}

export interface ScaffoldResult {
  projectDir: string
  dbPath: string
  files: string[]
  git: { initialized: boolean; committed: boolean }
  seed: InitialFactorySeedResult
}

export async function scaffoldFactory(input: ScaffoldInput): Promise<ScaffoldResult> {
  const runProcess = input.runProcess ?? defaultRunProcess
  const existed = existsSync(input.projectDir)
  const dbPath = join(input.projectDir, 'ductum.db')
  const files = ['ductum.db', '.gitignore']
  try {
    checkAbort(input.signal)
    if (input.validation == null) {
      await validateInitTarget(input.projectDir, runProcess, input.signal)
    } else {
      assertInitTargetValidation(input.validation, input.projectDir)
    }
    await mkdir(join(input.projectDir, '.ductum'), { recursive: true })
    input.hooks?.afterMkdir?.()
    checkAbort(input.signal)
    const agents = input.agents ?? (input.claudeAgent === true ? ['anthropic'] : [])
    await writeFile(join(input.projectDir, '.gitignore'), factoryGitignore, { encoding: 'utf8', flag: 'wx' })
    await writeFactorySecretKey(input.projectDir)
    const db = initDb(dbPath)
    let seed: InitialFactorySeedResult
    try {
      seed = seedInitialFactoryDatabase({
        db,
        factoryDir: input.projectDir,
        projectName: input.projectName,
        agents,
      })
    } finally {
      db.close()
    }
    checkAbort(input.signal)
    if (input.git) await initGit(input.projectDir, runProcess, input.signal)
    checkAbort(input.signal)
    return { projectDir: input.projectDir, dbPath, files: [...files, '.ductum/'], git: gitResult(input.git), seed }
  } catch (error) {
    if (!existed && existsSync(input.projectDir)) await rm(input.projectDir, { recursive: true, force: true })
    throw error
  }
}

export function showScaffolded(result: ScaffoldResult, ctx: CliContext): void {
  p.note([
    `directory: ${result.projectDir}`,
    `database: ${result.dbPath}`,
    `files: ${result.files.join(', ')}`,
    `git: ${result.git.committed ? 'initial commit created' : 'skipped'}`,
  ].join('\n'), 'Scaffolded', { input: ctx.stdin, output: ctx.stdout })
}

function gitResult(enabled: boolean): ScaffoldResult['git'] {
  return { initialized: enabled, committed: enabled }
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw initCancelledError()
}
