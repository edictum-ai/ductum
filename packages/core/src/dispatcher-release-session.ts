import type { DispatcherMcpServer } from './dispatcher-support.js'
import type { ActiveDispatchSession } from './dispatcher-types.js'
import { log } from './logger.js'
import { teardownSandboxRuntime } from './sandbox-runtime.js'

export async function releaseActiveDispatchSession(
  active: Pick<ActiveDispatchSession, 'mcpServer' | 'released' | 'sandboxRuntime'>,
  closeMcpServer: (mcpServer: DispatcherMcpServer) => Promise<void>,
): Promise<void> {
  if (active.released) return
  active.released = true
  await teardownSandboxRuntime(active.sandboxRuntime).catch((error) => {
    log.warn('dispatcher', `sandbox teardown failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  await closeMcpServer(active.mcpServer)
}
