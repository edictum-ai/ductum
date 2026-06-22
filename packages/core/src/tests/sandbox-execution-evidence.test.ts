import { describe, expect, it } from 'vitest'

import { confirmedSandboxAgentExecution, preparedSandboxAgentExecution } from '../sandbox-execution-evidence.js'
import { preparedSandbox } from '../sandbox-driver.js'
import type { PreparedSandboxRuntime } from '../sandbox-runtime.js'

const profile = { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container', spec: {} }
const boundary = { filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced' } as const

function podmanSandbox(): PreparedSandboxRuntime {
  return {
    ...preparedSandbox(profile, 'container', '/tmp/wt', ['/tmp/wt'], false, boundary),
    podman: { containerId: 'ctr-1', command: 'podman', workdir: '/ductum/worktree' },
  }
}

describe('sandbox execution evidence', () => {
  it('distinguishes host from prepared-container-only podman before agent spawn', () => {
    expect(preparedSandboxAgentExecution(preparedSandbox({ ...profile, provider: 'host', mode: 'worktree' }, 'host', '/tmp/wt', ['/tmp/wt'], false, { ...boundary, network: 'host', credentials: 'host', process: 'host' }))).toEqual({ mode: 'host', hostProcess: true })
    expect(preparedSandboxAgentExecution(podmanSandbox())).toEqual({ mode: 'prepared-container-only', hostProcess: true, container: { provider: 'podman', containerId: 'ctr-1', workdir: '/ductum/worktree' } })
  })

  it('requires the harness to confirm agent-contained podman execution', () => {
    const sandbox = podmanSandbox()
    expect(confirmedSandboxAgentExecution(sandbox, { sessionId: 's', runId: 'r' as never, sandboxExecution: { agentProcess: 'podman-container', containerId: 'ctr-1', workdir: '/ductum/worktree' }, waitForCompletion: async () => ({ exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 }) })).toMatchObject({ mode: 'agent-contained', hostProcess: false })
    expect(() => confirmedSandboxAgentExecution(sandbox, { sessionId: 's', runId: 'r' as never, sandboxExecution: { agentProcess: 'host' }, waitForCompletion: async () => ({ exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 }) })).toThrow('did not confirm agent-contained execution')
  })
})
