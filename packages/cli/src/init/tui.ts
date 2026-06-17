import type { CliContext, RunProcess } from '../runtime.js'
import { resolveInitPaths, validateInitTarget, type InitTargetValidation } from './paths.js'
import { confirmScaffold } from './steps/confirm.js'
import { promptDirectory } from './steps/directory.js'
import { promptProjectName } from './steps/project-name.js'
import { showWelcome } from './steps/welcome.js'

export interface InitPromptResult {
  dir: string
  projectName: string
  paths: ReturnType<typeof resolveInitPaths>
  validation: InitTargetValidation
}

export async function runInitPrompts(input: {
  ctx: CliContext
  dir?: string
  name?: string
  runProcess: RunProcess
  signal?: AbortSignal
}): Promise<InitPromptResult> {
  const promptOptions = { input: input.ctx.stdin, output: input.ctx.stdout }
  await showWelcome(promptOptions)
  const dir = await promptDirectory({
    dir: input.dir,
    env: input.ctx.env,
    promptOptions,
    runProcess: input.runProcess,
    signal: input.signal,
  })
  const projectName = await promptProjectName({ name: input.name, promptOptions })
  const paths = resolveInitPaths({ dir, projectName, env: input.ctx.env })
  const validation = await validateInitTarget(paths.projectDir, input.runProcess, input.signal)
  await confirmScaffold({ paths, promptOptions })
  return { dir, projectName, paths, validation }
}
