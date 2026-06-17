import * as p from '@clack/prompts'

import type { CliContext } from '../../runtime.js'
import { initCancelledError } from '../errors.js'
import { writeInitEvent } from '../events.js'
import type { InitPromptOptions } from './welcome.js'

export type InitAgentProvider = 'anthropic' | 'codex' | 'copilot'

const LABELS: Record<InitAgentProvider, string> = {
  anthropic: 'Claude builder',
  codex: 'Codex builder',
  copilot: 'GitHub Copilot builder',
}

export async function pickInitAgents(input: {
  ctx: CliContext
  authenticated: InitAgentProvider[]
  promptOptions?: InitPromptOptions
}): Promise<InitAgentProvider[]> {
  if (input.authenticated.length === 0) {
    writeInitEvent(input.ctx, 'init.agents_selected', { agents: [] })
    return []
  }
  if (input.ctx.outputMode !== 'human') {
    writeInitEvent(input.ctx, 'init.agents_selected', { agents: input.authenticated })
    return input.authenticated
  }
  const selected = await p.multiselect({
    message: 'Which agents should be enabled by default?',
    required: false,
    initialValues: input.authenticated,
    options: input.authenticated.map((provider) => ({ value: provider, label: LABELS[provider] })),
    ...input.promptOptions,
  })
  if (p.isCancel(selected)) throw initCancelledError()
  const agents = selected as InitAgentProvider[]
  writeInitEvent(input.ctx, 'init.agents_selected', { agents })
  return agents
}
