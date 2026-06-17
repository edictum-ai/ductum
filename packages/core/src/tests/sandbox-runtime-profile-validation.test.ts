import { describe, expect, it } from 'vitest'

import { HostSandboxDriver } from '../sandbox-driver.js'
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
      credentials: 'scoped',
      resources: 'none',
      process: 'host',
    })
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
