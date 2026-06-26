import * as p from '@clack/prompts'

import type { RunProcess } from '../../runtime.js'
import { initCancelledError } from '../errors.js'
import { DEFAULT_PROJECT_NAME, defaultInitInstallDir, resolveInitPaths, validateWritableDirectory } from '../paths.js'
import type { InitPromptOptions } from './welcome.js'

export async function promptDirectory(input: {
  dir?: string
  env: Record<string, string | undefined>
  promptOptions: InitPromptOptions
  runProcess: RunProcess
  signal?: AbortSignal
}): Promise<string> {
  const dir = input.dir ?? await textField('Where to install?', defaultInitInstallDir(input.env), input.promptOptions)
  await validateWritableDirectory(resolveInitPaths({
    dir,
    projectName: DEFAULT_PROJECT_NAME,
    env: input.env,
  }).installDir, input.runProcess, input.signal)
  return dir
}

async function textField(
  message: string,
  defaultValue: string,
  promptOptions: InitPromptOptions,
): Promise<string> {
  const value = await p.text({ message, defaultValue, placeholder: defaultValue, ...promptOptions })
  if (p.isCancel(value)) throw initCancelledError()
  return value.trim() === '' ? defaultValue : value
}
