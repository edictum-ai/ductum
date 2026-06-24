import type { CliContext, CliProgramDeps } from '../runtime.js'
import { writeInitEvent } from './events.js'
import type { InitOptions } from './options.js'
import { DEFAULT_INSTALL_DIR, resolveInitPaths, validateInitTarget, validateProjectName } from './paths.js'
import { defaultRunProcess } from './scaffolders/git-init.js'
import { throwIfAborted, withSigintAbort } from './sigint.js'
import { authenticateAnthropic } from './steps/auth-anthropic.js'
import { authenticateCodex } from './steps/auth-codex.js'
import { authenticateCopilot } from './steps/auth-copilot.js'
import { pickInitAgents, type InitAgentProvider } from './steps/agent-pickers.js'
import { runPostScaffoldHandoff } from './steps/browser-handoff.js'
import { renderNextSteps } from './steps/next-steps.js'
import { scaffoldFactory } from './steps/scaffold.js'

export async function runStructuredInit(
  ctx: CliContext,
  deps: CliProgramDeps,
  options: InitOptions,
): Promise<void> {
  const sigint = withSigintAbort()
  try {
    const git = options.git !== false
    const projectName = validateProjectName(options.name ?? 'factory')
    const paths = resolveInitPaths({ dir: options.dir ?? DEFAULT_INSTALL_DIR, projectName, env: ctx.env })
    writeInitEvent(ctx, 'init.started', { projectName, git })
    const runProcess = deps.runProcess ?? defaultRunProcess
    const validation = await validateInitTarget(paths.projectDir, runProcess, sigint.signal)
    throwIfAborted(sigint.signal)
    writeInitEvent(ctx, 'init.directory_resolved', { ...paths })
    const auth = await authenticateAnthropic({ ctx, deps, options, signal: sigint.signal })
    const codex = await authenticateCodex({ ctx, deps, options, signal: sigint.signal })
    const copilot = await authenticateCopilot({ ctx, deps, options, signal: sigint.signal })
    const agents = await pickInitAgents({
      ctx,
      authenticated: authenticatedAgents(auth.authenticated, codex.authenticated, copilot.authenticated),
    })
    const result = await scaffoldFactory({ ...paths, git, runProcess, signal: sigint.signal, validation, agents })
    throwIfAborted(sigint.signal)
    writeInitEvent(ctx, 'init.scaffolded', {
      projectDir: result.projectDir,
      dbPath: result.dbPath,
      files: result.files,
      git: result.git,
      seed: {
        projectId: result.seed.project.id,
        repositoryId: result.seed.repository.id,
        componentId: result.seed.component.id,
        agentCount: result.seed.agents.length,
      },
    })
    const handoff = await (deps.initHandoff?.run ?? runPostScaffoldHandoff)({
      ctx,
      options,
      projectDir: paths.projectDir,
      projectName,
      agents,
      seed: { agentCount: result.seed.agents.length, skippedAgents: [] },
      signal: sigint.signal,
      deps: deps.initHandoff,
    })
    writeInitEvent(ctx, 'init.completed', {
      projectDir: paths.projectDir,
      nextSteps: renderNextSteps(paths.projectDir, handoff).split('\n'),
    })
  } finally {
    sigint.dispose()
  }
}

function authenticatedAgents(anthropic: boolean, codex: boolean, copilot: boolean): InitAgentProvider[] {
  return [
    anthropic ? 'anthropic' : null,
    codex ? 'codex' : null,
    copilot ? 'copilot' : null,
  ].filter((value): value is InitAgentProvider => value != null)
}
