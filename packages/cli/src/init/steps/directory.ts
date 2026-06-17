import * as p from '@clack/prompts'

import type { RunProcess } from '../../runtime.js'
import { initCancelledError } from '../errors.js'
import { DEFAULT_INSTALL_DIR, resolveInitPaths, validateWritableDirectory } from '../paths.js'
import type { InitPromptOptions } from './welcome.js'

export async function promptDirectory(input: {
  dir?: string
  env: Record<string, string | undefined>
  promptOptions: InitPromptOptions
  runProcess: RunProcess
  signal?: AbortSignal
}): Promise<string> {
  const dir = input.dir ?? await textField('Where to install?', DEFAULT_INSTALL_DIR, input.promptOptions)
  await validateWritableDirectory(resolveInitPaths({
    dir,
    projectName: 'factory',
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
