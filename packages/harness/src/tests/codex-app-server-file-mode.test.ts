import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCodexContainerLaunchEnv } from '../codex-app-server-process.js'
import { describe, expect, it } from 'vitest'

function containerSandbox(runtimeHostDir: string) {
  return {
    driver: 'container' as const,
    profile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container' },
    workingDir: '/tmp/ductum-run',
    worktreePaths: ['/tmp/ductum-run'],
    reusedWorktree: false,
    boundary: {
      filesystem: 'worktree-readWrite' as const,
      network: 'container-default' as const,
      credentials: 'scoped' as const,
      resources: 'none' as const,
      process: 'namespaced' as const,
    },
    podman: {
      containerId: 'ctr-1',
      runId: 'run-1',
      command: '/usr/bin/podman',
      workdir: '/ductum/worktree',
      runtimeHostDir,
      runtimeDir: '/ductum/runtime',
    },
  }
}

function expectOwnerOnlyMode(path: string): void {
  if (process.platform === 'win32') return
  expect(statSync(path).mode & 0o777).toBe(0o600)
}

describe('Codex auth file mode hardening', () => {
  it('rewrites copied Codex auth files to 0600 without changing contents', () => {
    const sourceHome = mkdtempSync(join(tmpdir(), 'ductum-scoped-codex-'))
    const runtimeHostDir = mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))
    const sourceAuth = join(sourceHome, 'auth.json')
    const original = '{"token":"secret"}\n'
    writeFileSync(sourceAuth, original, { mode: 0o644 })
    chmodSync(sourceAuth, 0o644)

    buildCodexContainerLaunchEnv(containerSandbox(runtimeHostDir), {
      PATH: '/bin',
      DUCTUM_SCOPED_CODEX_HOME: sourceHome,
    } as NodeJS.ProcessEnv)

    const copiedAuth = join(runtimeHostDir, 'codex-home', 'auth.json')
    expect(readFileSync(copiedAuth, 'utf8')).toBe(original)
    expectOwnerOnlyMode(copiedAuth)
    expectOwnerOnlyMode(join(runtimeHostDir, 'codex-home', 'config.toml'))
  })
})
