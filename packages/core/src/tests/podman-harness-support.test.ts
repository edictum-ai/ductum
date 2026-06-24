import { describe, expect, it } from 'vitest'

import { assertPodmanHarnessSupportsContainer } from '../podman-harness-support.js'

const runtime = (supportedSandboxes: string[]) => ({
  sandboxProfile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container', spec: {} },
  harnessSnapshot: { spec: { supportedSandboxes } },
}) as never

describe('podman harness support', () => {
  it('fails closed for harnesses that are not wired to podman exec', () => {
    expect(() => assertPodmanHarnessSupportsContainer(runtime(['container']), { name: 'claude', harness: 'claude-agent-sdk' } as never))
      .toThrow('does not support podman/container sandbox execution')
    expect(() => assertPodmanHarnessSupportsContainer(runtime(['container']), { name: 'codex', harness: 'codex-sdk' } as never))
      .not.toThrow()
  })

  it('fails closed when the harness does not explicitly declare container support', () => {
    expect(() => assertPodmanHarnessSupportsContainer(runtime(['worktree']), { name: 'codex', harness: 'codex-sdk' } as never))
      .toThrow('does not declare container sandbox support')
  })
})
