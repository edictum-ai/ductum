import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { AgentRuntimeResolutionError } from './agent-runtime-resolution.js'
import type { Agent } from './types.js'

export interface AgentSystemPromptRuntime {
  ref: string
  path: string
  bytes: number
  sha256: string
  content: string
}

export async function resolveAgentSystemPrompt(
  agent: Pick<Agent, 'name' | 'resourceRefs'>,
  workingDir: string | null | undefined,
): Promise<AgentSystemPromptRuntime | null> {
  const rawRef = agent.resourceRefs?.systemPromptRef
  if (rawRef == null) return null
  const ref = rawRef.trim()
  if (ref === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef must not be empty`, 'resource_malformed')
  }
  if (isAbsolute(ref)) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" must be relative`, 'resource_malformed')
  }
  const root = workingDir?.trim()
  if (root == null || root === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" requires a resolved working directory`, 'runtime_config_missing')
  }
  let rootPath: string
  try {
    rootPath = await realpath(resolve(root))
  } catch (error) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" requires a readable working directory: ${errorMessage(error)}`, 'runtime_config_missing')
  }
  const promptPath = resolve(rootPath, ref)
  const rel = relative(rootPath, promptPath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" must stay under the run working directory`, 'resource_malformed')
  }
  let realPromptPath: string
  try {
    realPromptPath = await realpath(promptPath)
  } catch (error) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" could not be read: ${errorMessage(error)}`, 'resource_malformed')
  }
  const realRel = relative(rootPath, realPromptPath)
  if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" must stay under the run working directory`, 'resource_malformed')
  }
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(realPromptPath)
  } catch (error) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" could not be read: ${errorMessage(error)}`, 'resource_malformed')
  }
  if (!fileStat.isFile()) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" must resolve to a file`, 'resource_malformed')
  }
  let content: string
  try {
    content = await readFile(realPromptPath, 'utf8')
  } catch (error) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" could not be read: ${errorMessage(error)}`, 'resource_malformed')
  }
  if (content.trim() === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} systemPromptRef "${ref}" resolved to an empty prompt file`, 'resource_malformed')
  }
  return {
    ref,
    path: realPromptPath,
    bytes: Buffer.byteLength(content, 'utf8'),
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    content,
  }
}

export function composeAgentSystemPrompt(agentPrompt: string, dispatcherPrompt: string): string {
  return [agentPrompt.trimEnd(), '', '---', '', dispatcherPrompt].join('\n')
}

export function agentSystemPromptEvidence(runtime: AgentSystemPromptRuntime) {
  return {
    ref: runtime.ref,
    path: runtime.path,
    bytes: runtime.bytes,
    sha256: runtime.sha256,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
