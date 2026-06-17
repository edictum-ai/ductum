import type { CliContext, CliProgramDeps } from '../runtime.js'
import type { InitOptions } from './options.js'
import { DEFAULT_INSTALL_DIR, resolveInitPaths, validateInitTarget, validateProjectName } from './paths.js'
import { defaultRunProcess } from './scaffolders/git-init.js'
import { rejectOnAbort, throwIfAborted, withSigintAbort } from './sigint.js'
import { authenticateAnthropic } from './steps/auth-anthropic.js'
import { authenticateCodex } from './steps/auth-codex.js'
import { authenticateCopilot } from './steps/auth-copilot.js'
import { pickInitAgents, type InitAgentProvider } from './steps/agent-pickers.js'
import { runPostScaffoldHandoff } from './steps/browser-handoff.js'
import { showNextSteps } from './steps/next-steps.js'
import { scaffoldFactory, showScaffolded } from './steps/scaffold.js'
import { runInitPrompts } from './tui.js'

export async function runHumanInit(
  ctx: CliContext,
  deps: CliProgramDeps,
  options: InitOptions,
): Promise<void> {
  const git = options.git !== false
  const sigint = withSigintAbort()
  try {
    const runProcess = deps.runProcess ?? defaultRunProcess
    const prompt = options.resume === true
      ? await resumeInitTarget(ctx, options, runProcess, sigint.signal)
      : await rejectOnAbort(runInitPrompts({
          ctx,
          dir: options.dir,
          name: options.name,
          runProcess,
          signal: sigint.signal,
        }), sigint.signal)
    const auth = await rejectOnAbort(authenticateAnthropic({
      ctx,
      deps,
      options,
      signal: sigint.signal,
      promptOptions: { input: ctx.stdin, output: ctx.stdout },
    }), sigint.signal)
    const codex = await rejectOnAbort(authenticateCodex({
      ctx,
      deps,
      options,
      signal: sigint.signal,
      promptOptions: { input: ctx.stdin, output: ctx.stdout },
    }), sigint.signal)
    const copilot = await rejectOnAbort(authenticateCopilot({
      ctx,
      deps,
      options,
      signal: sigint.signal,
      promptOptions: { input: ctx.stdin, output: ctx.stdout },
    }), sigint.signal)
    const agents = await pickInitAgents({
      ctx,
      authenticated: authenticatedAgents(auth.authenticated, codex.authenticated, copilot.authenticated),
      promptOptions: { input: ctx.stdin, output: ctx.stdout },
    })
    const result = await scaffoldFactory({
      ...prompt.paths,
      git,
      runProcess,
      signal: sigint.signal,
      validation: prompt.validation,
      agents,
    })
    throwIfAborted(sigint.signal)
    showScaffolded(result, ctx)
    const handoff = await rejectOnAbort((deps.initHandoff?.run ?? runPostScaffoldHandoff)({
      ctx,
      options,
      projectDir: prompt.paths.projectDir,
      projectName: prompt.projectName,
      agents,
      seed: { agentCount: result.seed.agents.length, skippedAgents: [] },
      signal: sigint.signal,
      deps: deps.initHandoff,
    }), sigint.signal)
    showNextSteps(prompt.paths.projectDir, ctx, handoff)
  } finally {
    sigint.dispose()
  }
}

async function resumeInitTarget(
  ctx: CliContext,
  options: InitOptions,
  runProcess: NonNullable<CliProgramDeps['runProcess']>,
  signal: AbortSignal,
): ReturnType<typeof runInitPrompts> {
  const dir = options.dir ?? DEFAULT_INSTALL_DIR
  const projectName = validateProjectName(options.name ?? 'factory')
  const paths = resolveInitPaths({ dir, projectName, env: ctx.env })
  const validation = await validateInitTarget(paths.projectDir, runProcess, signal)
  return { dir, projectName, paths, validation }
}

function authenticatedAgents(anthropic: boolean, codex: boolean, copilot: boolean): InitAgentProvider[] {
  return [
    anthropic ? 'anthropic' : null,
    codex ? 'codex' : null,
    copilot ? 'copilot' : null,
  ].filter((value): value is InitAgentProvider => value != null)
}
