import { describe, expect, it, vi } from 'vitest'

import type { DispatcherMcpServer } from '../dispatcher-support.js'
import type { ActiveDispatchSession } from '../dispatcher-types.js'
import { releaseActiveDispatchSession } from '../dispatcher-release-session.js'
import { teardownSandboxRuntime } from '../sandbox-runtime.js'

vi.mock('../sandbox-runtime.js', () => ({
  teardownSandboxRuntime: vi.fn(),
}))

const mockedTeardown = vi.mocked(teardownSandboxRuntime)

type ReleaseSession = Pick<ActiveDispatchSession, 'mcpServer' | 'released' | 'sandboxRuntime'>

function activeSession(): ReleaseSession {
  return {
    mcpServer: { close: vi.fn(async () => {}) } as DispatcherMcpServer,
    released: false,
    sandboxRuntime: { driver: 'container' } as never,
  }
}

describe('dispatcher podman teardown release failures', () => {
  it('fails normal release when sandbox teardown throws', async () => {
    const active = activeSession()
    const close = vi.fn(async () => {})
    mockedTeardown.mockRejectedValueOnce(new Error('podman cleanup failed for container c1: timeout'))

    await expect(releaseActiveDispatchSession(active, close)).rejects.toThrow(
      'sandbox teardown failed during dispatcher release: podman cleanup failed for container c1: timeout',
    )
    expect(close).toHaveBeenCalledWith(active.mcpServer)
  })

  it('does not record a teardown failure as a clean successful release', async () => {
    const active = activeSession()
    mockedTeardown.mockRejectedValueOnce(new Error('podman rm failed'))

    await expect(releaseActiveDispatchSession(active, vi.fn(async () => {})))
      .rejects.toThrow('podman rm failed')
    expect(active.released).toBe(false)
  })

  it('closes the MCP server and clears session state on successful release', async () => {
    const active = activeSession()
    const close = vi.fn(async () => {})
    mockedTeardown.mockResolvedValueOnce(undefined)

    await expect(releaseActiveDispatchSession(active, close)).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledWith(active.mcpServer)
    expect(active.released).toBe(true)
  })

  it('does not let best-effort MCP close failure hide sandbox cleanup failure', async () => {
    const active = activeSession()
    mockedTeardown.mockRejectedValueOnce(new Error('podman cleanup failed'))

    await expect(releaseActiveDispatchSession(active, vi.fn(async () => {
      throw new Error('mcp close failed')
    }))).rejects.toThrow('podman cleanup failed')
    expect(active.released).toBe(false)
  })
})
