import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildCodexContainerLaunchEnv } from '../codex-app-server-process.js'

function scopedCodexHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ductum-scoped-codex-'))
  writeFileSync(join(home, 'auth.json'), '{}')
  return home
}

function containerSandbox(runtimeHostDir: string) {
  return {
    driver: 'container' as const,
    profile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container' },
    workingDir: '/tmp/ductum-run', worktreePaths: ['/tmp/ductum-run'], reusedWorktree: false,
    boundary: { filesystem: 'worktree-readWrite' as const, network: 'container-default' as const, credentials: 'scoped' as const, resources: 'none' as const, process: 'namespaced' as const },
    podman: { containerId: 'ctr-1', runId: 'run-1', command: '/usr/bin/podman', workdir: '/ductum/worktree', runtimeHostDir, runtimeDir: '/ductum/runtime' },
  }
}

describe('Codex Podman container launch env', () => {
  it('allows API-key scoped containerized Codex without a scoped Codex home', () => {
    const runtimeHostDir = mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))
    const env = buildCodexContainerLaunchEnv(containerSandbox(runtimeHostDir), {
      OPENAI_API_KEY: 'sk-scoped',
      CODEX_HOME: scopedCodexHome(),
    } as NodeJS.ProcessEnv)
    expect(env.OPENAI_API_KEY).toBe('sk-scoped')
    expect(env.CODEX_HOME).toBe('/ductum/runtime/codex-home')
    expect(existsSync(join(runtimeHostDir, 'codex-home', 'config.toml'))).toBe(true)
    expect(existsSync(join(runtimeHostDir, 'codex-home', 'auth.json'))).toBe(false)
  })

  it('fails closed for containerized Codex without any scoped credential source', () => {
    expect(() => buildCodexContainerLaunchEnv(containerSandbox(mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))), {
      CODEX_HOME: scopedCodexHome(),
    } as NodeJS.ProcessEnv)).toThrow('requires OPENAI_API_KEY, CODEX_API_KEY, or DUCTUM_SCOPED_CODEX_HOME')
  })

  it('does not forward unscoped warn-mode host environment into Podman exec', () => {
    const env = buildCodexContainerLaunchEnv(containerSandbox(mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))), {
      PATH: '/bin', OPENAI_API_KEY: 'sk-scoped', STRIPE_KEY: 'sk-stripe-leak', AWS_SECRET_ACCESS_KEY: 'aws-leak',
      DUCTUM_SECRET_BROKER_MODE: 'warn', DUCTUM_SOURCE_CODEX_HOME: '/host/codex', DUCTUM_CODEX_HOME: '/host/ductum-codex', CODEX_HOME: '/host/.codex',
    } as NodeJS.ProcessEnv)
    expect(env.OPENAI_API_KEY).toBe('sk-scoped')
    expect(env.STRIPE_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.DUCTUM_SECRET_BROKER_MODE).toBeUndefined()
    expect(env.DUCTUM_SOURCE_CODEX_HOME).toBeUndefined()
    expect(env.DUCTUM_CODEX_HOME).toBeUndefined()
  })
})
