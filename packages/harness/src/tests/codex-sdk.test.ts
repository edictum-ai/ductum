import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAppServerHarnessAdapter } from '../codex-app-server.js'
import { CodexSDKHarnessAdapter } from '../codex-sdk.js'
import { createRun, createTask } from './helpers.js'

describe('CodexSDKHarnessAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delegates spawn through the approval-enforced codex app-server adapter', async () => {
    const session = {
      sessionId: 'codex-as-1',
      runId: 'run-1' as never,
      waitForCompletion: vi.fn(),
    }
    const spawnSpy = vi
      .spyOn(CodexAppServerHarnessAdapter.prototype, 'spawn')
      .mockResolvedValue(session)
    const adapter = new CodexSDKHarnessAdapter('http://ductum.test')
    const run = createRun()
    const task = createTask()

    const result = await adapter.spawn(run, task, 'system prompt', {} as never, {
      workingDir: '/tmp/ductum-run',
    })

    expect(result).toBe(session)
    expect(spawnSpy).toHaveBeenCalledWith(run, task, 'system prompt', {} as never, {
      workingDir: '/tmp/ductum-run',
    })
  })
})
