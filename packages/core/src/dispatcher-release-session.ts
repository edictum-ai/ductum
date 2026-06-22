import type { DispatcherMcpServer } from './dispatcher-support.js'
import type { ActiveDispatchSession } from './dispatcher-types.js'
import { log } from './logger.js'
import { teardownSandboxRuntime } from './sandbox-runtime.js'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function releaseActiveDispatchSession(
  active: Pick<ActiveDispatchSession, 'mcpServer' | 'released' | 'sandboxRuntime'>,
  closeMcpServer: (mcpServer: DispatcherMcpServer) => Promise<void>,
): Promise<void> {
  if (active.released) return
  let teardownError: unknown
  try {
    await teardownSandboxRuntime(active.sandboxRuntime)
  } catch (error) {
    teardownError = error
  }

  try {
    await closeMcpServer(active.mcpServer)
  } catch (error) {
    log.warn('dispatcher', `MCP server close failed during release: ${errorMessage(error)}`)
  }

  if (teardownError != null) {
    throw new Error(`sandbox teardown failed during dispatcher release: ${errorMessage(teardownError)}`, {
      cause: teardownError,
    })
  }
  active.released = true
}
