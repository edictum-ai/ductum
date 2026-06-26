import * as p from '@clack/prompts'

import { initCancelledError } from '../errors.js'
import type { InitPaths } from '../paths.js'
import type { InitPromptOptions } from './welcome.js'

export async function confirmScaffold(input: {
  paths: InitPaths
  promptOptions: InitPromptOptions
}): Promise<void> {
  p.note([
    `factory: ${input.paths.projectName}`,
    `data dir: ${input.paths.projectDir}`,
    'storage: SQLite database (ductum.db)',
    'local state: .ductum/ inside the external factory data dir',
    'yaml: not created',
  ].join('\n'), `Create ${input.paths.projectDir}`, input.promptOptions)
  const confirmed = await p.confirm({
    message: 'Create this factory?',
    initialValue: false,
    ...input.promptOptions,
  })
  if (p.isCancel(confirmed) || confirmed !== true) throw initCancelledError()
}
