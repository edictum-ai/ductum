import { describe, expect, it } from 'vitest'

import type { PodmanInvocation } from '../podman-sandbox-driver.js'
import { confirmedSandboxAgentExecution, preparedSandboxAgentExecution } from '../sandbox-execution-evidence.js'
import { preparedSandbox } from '../sandbox-driver.js'
import type { PreparedSandboxRuntime } from '../sandbox-runtime.js'

const profile = { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container', spec: {} }
const boundary = { filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced' } as const

function podmanSandbox(): PreparedSandboxRuntime {
  return {
    ...preparedSandbox(profile, 'container', '/tmp/wt', ['/tmp/wt'], false, boundary),
    podman: {
      containerId: 'ctr-1',
      runId: 'run-1',
      command: 'podman',
      workdir: '/ductum/worktree',
      runtimeDir: '/ductum/runtime',
      runtimeHostDir: '/tmp/runtime',
      proof: { filePath: '/ductum/runtime/agent-launch-proof.json', nonce: 'nonce-1' },
    },
  }
}

function proofInvocation(overrides: Partial<{
  labels: string[]
  mounts: string
  proof: Record<string, string>
  proofStatus: number | null
}> = {}): PodmanInvocation {
  return (args) => {
    if (args[0] === 'inspect' && args[2]?.includes('ductum.proofNonce')) {
      return {
        status: 0,
        stdout: (overrides.labels ?? [
          'podman',
          'run-1',
          '/tmp/wt',
          '/tmp/runtime',
          '/ductum/runtime/agent-launch-proof.json',
          'nonce-1',
          '/ductum/worktree',
        ]).join('\n'),
        stderr: '',
      }
    }
    if (args[0] === 'inspect' && args[2]?.includes('.Mounts')) {
      return {
        status: 0,
        stdout: overrides.mounts ?? '/tmp/wt|/ductum/worktree|true\n/tmp/runtime|/ductum/runtime|true\n',
        stderr: '',
      }
    }
    if (args[0] === 'exec') {
      return {
        status: overrides.proofStatus ?? 0,
        stdout: JSON.stringify(overrides.proof ?? {
          kind: 'ductum-podman-agent-launch-proof',
          runId: 'run-1',
          containerId: 'ctr-1',
          workdir: '/ductum/worktree',
          nonce: 'nonce-1',
        }),
        stderr: '',
      }
    }
    throw new Error(`unexpected podman args: ${args.join(' ')}`)
  }
}

describe('sandbox execution evidence', () => {
  it('distinguishes host from prepared-container-only podman before agent spawn', () => {
    expect(preparedSandboxAgentExecution(preparedSandbox({ ...profile, provider: 'host', mode: 'worktree' }, 'host', '/tmp/wt', ['/tmp/wt'], false, { ...boundary, network: 'host', credentials: 'host', process: 'host' }))).toEqual({ mode: 'host', hostProcess: true })
    expect(preparedSandboxAgentExecution(podmanSandbox())).toEqual({ mode: 'prepared-container-only', hostProcess: true, container: { provider: 'podman', containerId: 'ctr-1', workdir: '/ductum/worktree' } })
  })

  it('requires independent podman proof in addition to harness self-report', () => {
    expect(() => confirmedSandboxAgentExecution(podmanSandbox(), session(), (() => ({ status: 1, stdout: '', stderr: 'inspect failed' })) as PodmanInvocation))
      .toThrow('Independent podman proof failed')
  })

  it('records agent-contained execution only when inspect, mounts, and proof match the prepared sandbox', () => {
    expect(confirmedSandboxAgentExecution(podmanSandbox(), session(), proofInvocation())).toMatchObject({
      mode: 'agent-contained',
      hostProcess: false,
      container: {
        provider: 'podman',
        containerId: 'ctr-1',
        workdir: '/ductum/worktree',
        proof: {
          kind: 'ductum-podman-agent-launch-proof',
          runId: 'run-1',
          hostWorktree: '/tmp/wt',
          markerFile: '/ductum/runtime/agent-launch-proof.json',
          nonce: 'nonce-1',
          verifiedBy: 'podman-inspect+exec',
        },
      },
    })
  })

  it.each([
    ['host harness report', session({ sandboxExecution: { agentProcess: 'host' } })],
    ['wrong container id', session({ sandboxExecution: { agentProcess: 'podman-container', containerId: 'ctr-2', workdir: '/ductum/worktree' } })],
    ['wrong workdir', session({ sandboxExecution: { agentProcess: 'podman-container', containerId: 'ctr-1', workdir: '/wrong' } })],
  ] as const)('rejects %s', (_label, badSession) => {
    expect(() => confirmedSandboxAgentExecution(podmanSandbox(), badSession, proofInvocation())).toThrow('did not confirm agent-contained execution')
  })

  it.each([
    ['stale proof nonce', proofInvocation({ proof: { kind: 'ductum-podman-agent-launch-proof', runId: 'run-1', containerId: 'ctr-1', workdir: '/ductum/worktree', nonce: 'stale' } })],
    ['wrong run label', proofInvocation({ labels: ['podman', 'run-2', '/tmp/wt', '/tmp/runtime', '/ductum/runtime/agent-launch-proof.json', 'nonce-1', '/ductum/worktree'] })],
    ['missing worktree mount', proofInvocation({ mounts: '/tmp/runtime|/ductum/runtime|true\n' })],
    ['missing proof file', proofInvocation({ proofStatus: 1 })],
  ] as const)('rejects %s', (_label, invocation) => {
    expect(() => confirmedSandboxAgentExecution(podmanSandbox(), session(), invocation)).toThrow('Independent podman proof failed')
  })
})

function session(overrides: Partial<{
  sandboxExecution: { agentProcess: 'host' | 'podman-container'; containerId?: string; workdir?: string }
}> = {}) {
  return {
    sessionId: 's',
    runId: 'r' as never,
    sandboxExecution: overrides.sandboxExecution ?? { agentProcess: 'podman-container' as const, containerId: 'ctr-1', workdir: '/ductum/worktree' },
    waitForCompletion: async () => ({ exitReason: 'completed' as const, tokensIn: 0, tokensOut: 0, costUsd: 0 }),
  }
}
