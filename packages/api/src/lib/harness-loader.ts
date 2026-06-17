import {
  extractWorkflowReadPath,
  isSimpleWorkflowReadCommand,
  log,
  type HarnessAdapter,
  type RunId,
} from '@ductum/core'

export interface HarnessModuleShape {
  loadBuiltInHarnessAdapters?: (options: {
    apiUrl: string
    codexAppServerApproval?: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
    mockAgentCalls?: boolean
  }) => {
    adapters: Map<string, HarnessAdapter>
    loaded: Array<{ id: string; loadMessage: string }>
  }
}

export interface LoadHarnessAdaptersInput {
  apiUrl: string
  enableDispatch: boolean
  authorizeTool?: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<{ allowed: boolean }>
  mockAgentCalls?: boolean
}

export interface LoadHarnessAdaptersResult {
  harnessAdapters: Map<string, HarnessAdapter>
  harnessLoadFailed: boolean
}

interface CodexAppServerAuthorizationTool {
  toolName: string
  args: Record<string, unknown>
}

/**
 * Codex app-server sometimes sends simple file reads as Bash. Treat only those
 * single-file read commands as Read for authorization. Compound exploration
 * stays Bash so command-scope checks still inspect the full shell command.
 */
export function classifyCodexAppServerTool(toolName: string, toolArgs: Record<string, unknown>): string {
  return resolveCodexAppServerAuthorizationTool(toolName, toolArgs).toolName
}

export function resolveCodexAppServerAuthorizationTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
): CodexAppServerAuthorizationTool {
  if (toolName !== 'Bash') return { toolName, args: toolArgs }
  const cmd = String(toolArgs.command ?? '')
  const filePath = isSimpleWorkflowReadCommand(cmd) ? extractWorkflowReadPath(cmd) : null
  if (filePath != null) {
    return { toolName: 'Read', args: { file_path: filePath } }
  }
  return { toolName: 'Bash', args: toolArgs }
}

export function createCodexAppServerApproval(
  authorizeTool?: LoadHarnessAdaptersInput['authorizeTool'],
): (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean> {
  return async (runId, toolName, toolArgs) => {
    if (authorizeTool == null) return true
    try {
      const effective = resolveCodexAppServerAuthorizationTool(toolName, toolArgs)
      const result = await authorizeTool(runId, effective.toolName, effective.args)
      return result.allowed
    } catch (error) {
      log.error('enforce', `codex-app-server authorization failed closed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}

export function loadHarnessAdaptersFromModule(
  harness: HarnessModuleShape,
  input: LoadHarnessAdaptersInput,
): LoadHarnessAdaptersResult {
  if (!input.enableDispatch) {
    return { harnessAdapters: new Map(), harnessLoadFailed: false }
  }
  if (typeof harness.loadBuiltInHarnessAdapters !== 'function') {
    throw new Error('@ductum/harness is missing loadBuiltInHarnessAdapters()')
  }
  const { adapters, loaded } = harness.loadBuiltInHarnessAdapters({
    apiUrl: input.apiUrl,
    codexAppServerApproval: createCodexAppServerApproval(input.authorizeTool),
    mockAgentCalls: input.mockAgentCalls === true,
  })
  for (const entry of loaded) {
    log.info('startup', entry.loadMessage)
  }
  return { harnessAdapters: adapters, harnessLoadFailed: false }
}

export async function loadHarnessAdapters(
  input: LoadHarnessAdaptersInput,
): Promise<LoadHarnessAdaptersResult> {
  if (!input.enableDispatch) {
    return { harnessAdapters: new Map(), harnessLoadFailed: false }
  }
  try {
    // Dynamic import — @ductum/harness is optional, may not be installed.
    // Keep the package name non-literal so test bundlers do not try to
    // eagerly resolve an optional dependency during collection.
    const packageName = process.env.DUCTUM_HARNESS_MODULE_PATH ?? '@ductum/harness'
    const harness = await import(packageName) as HarnessModuleShape
    return loadHarnessAdaptersFromModule(harness, input)
  } catch (error) {
    log.warn('startup', `Harness: @ductum/harness not available — dispatch disabled: ${error instanceof Error ? error.message : String(error)}`)
    return { harnessAdapters: new Map(), harnessLoadFailed: true }
  }
}
