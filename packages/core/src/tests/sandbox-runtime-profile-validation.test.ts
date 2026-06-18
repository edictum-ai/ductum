import { describe, expect, it } from 'vitest'

import { HostSandboxDriver } from '../sandbox-driver.js'
import type { SandboxSpec } from '../sandbox-driver.js'
import { assertSupportedSandboxProfileSpec } from '../sandbox-runtime.js'
import type { RunSandboxProfileSnapshot } from '../types.js'

describe('sandbox runtime profile validation', () => {
  it('accepts the supported host/worktree profile shape', () => {
    const snapshot = profile()

    expect(() => assertSupportedSandboxProfileSpec(
      snapshot,
      {
        provider: 'host',
        mode: 'worktree',
        filesystem: { worktree: 'readWrite' },
        network: { mode: 'host' },
        credentials: {},
        resources: {},
        process: {},
      },
    )).not.toThrow()
  })

  it('reports the host driver boundary honestly', () => {
    expect(new HostSandboxDriver().boundary()).toEqual({
      filesystem: 'worktree-readWrite',
      network: 'host',
      credentials: 'host',
      resources: 'none',
      process: 'host',
    })
  })

  it('admits a future container-shaped sandbox spec', () => {
    const spec = {
      kind: 'container',
      provider: 'docker',
      mode: 'container',
      image: 'ghcr.io/edictum/worker:latest',
      network: { mode: 'egress-allowlist', allowlist: ['api.github.com'] },
      credentials: { mode: 'scoped' },
      process: { mode: 'namespaced' },
    } satisfies SandboxSpec

    expect(spec.kind).toBe('container')
  })

  it.each([
    ['provider/mode', profile('local', 'permissive'), { provider: 'local', mode: 'permissive' }, 'unsupported sandbox runtime local/permissive'],
    ['filesystem', profile(), { provider: 'host', mode: 'worktree', filesystem: { root: '/tmp/ductum' } }, 'filesystem.root'],
    ['network', profile(), { provider: 'host', mode: 'worktree', network: { mode: 'none' } }, 'network.mode=none'],
    ['credentials', profile(), { provider: 'host', mode: 'worktree', credentials: { expose: ['github'] } }, 'spec.credentials'],
    ['resources', profile(), { provider: 'host', mode: 'worktree', resources: { cpu: 2 } }, 'spec.resources'],
    ['process', profile(), { provider: 'host', mode: 'worktree', process: { uid: 1000 } }, 'spec.process'],
  ] as const)('rejects unsupported %s claims', (_name, snapshot, spec, expected) => {
    expect(() => assertSupportedSandboxProfileSpec(snapshot, spec)).toThrow(expected)
  })
})

function profile(provider = 'host', mode = 'worktree'): RunSandboxProfileSnapshot {
  return {
    id: 'sandbox-id' as never,
    name: 'builder-worktree',
    projectId: null,
    provider,
    mode,
    spec: { provider, mode },
  }
}
