import * as p from '@clack/prompts'

import type { CliContext } from '../../runtime.js'
import { initCancelledError } from '../errors.js'

export interface InitPromptOptions {
  input: CliContext['stdin']
  output: CliContext['stdout']
}

export async function showWelcome(promptOptions: InitPromptOptions): Promise<void> {
  p.intro('ductum init', promptOptions)
  p.note('Create a local DB-backed factory directory.', 'Welcome', promptOptions)
  const value = await p.text({
    message: 'Press Enter to continue',
    defaultValue: '',
    placeholder: '',
    validate: (input) => (input ?? '').trim() === '' ? undefined : 'Press Enter with no text to continue.',
    ...promptOptions,
  })
  if (p.isCancel(value)) throw initCancelledError()
}
