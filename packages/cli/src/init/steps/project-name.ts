import * as p from '@clack/prompts'

import { initCancelledError } from '../errors.js'
import { DEFAULT_PROJECT_NAME, validateProjectName } from '../paths.js'
import type { InitPromptOptions } from './welcome.js'

export async function promptProjectName(input: {
  name?: string
  promptOptions: InitPromptOptions
}): Promise<string> {
  const value = input.name ?? await p.text({
    message: 'Project name?',
    defaultValue: DEFAULT_PROJECT_NAME,
    placeholder: DEFAULT_PROJECT_NAME,
    ...input.promptOptions,
  })
  if (p.isCancel(value)) throw initCancelledError()
  return validateProjectName(value.trim() === '' ? DEFAULT_PROJECT_NAME : value)
}
