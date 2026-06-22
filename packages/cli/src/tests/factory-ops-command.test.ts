import { describe, expect, it, vi } from 'vitest'

import { activeRun, createMockApi, runCommand } from './helpers.js'

describe('ductum factory operator commands', () => {
  it('denies a pending approval with an operator reason', async () => {
    const api = createMockApi()
    const result = await runCommand(['deny', 'run-approval-1', '--reason', 'needs cleaner settings copy'], api)

    expect(result.code).toBe(0)
    expect(api.rejectRun).toHaveBeenCalledWith('run-approval-1', 'needs cleaner settings copy')
    expect(result.text).toContain('rejected')
    expect(result.text).toContain('phase: Awaiting approval')
    expect(result.text).toContain('result: Failed')
    expect(result.text).toContain('next: retry run-active')
    expect(result.text).not.toContain('run-close')
  })

  it('does not keep reject as a compatibility alias', async () => {
    const result = await runCommand(['reject', 'run-approval-2', '--reason', 'bad merge risk'])

    expect(result.code).not.toBe(0)
    expect(result.errorText).toMatch(/unknown command/i)
  })

  it('approves an Attempt through the normal approval command', async () => {
    const api = createMockApi({
      approveRun: vi.fn().mockResolvedValue({
        success: true,
        stage: 'done',
        branch: 'feat/attempt',
        commitSha: 'abc123def',
        pushed: true,
      }),
    })

    const result = await runCommand(['approve', activeRun.id], api)

    expect(result.code).toBe(0)
    expect(api.approveRun).toHaveBeenCalledWith(activeRun.id)
    expect(result.text).toContain('approved')
    expect(result.text).toContain('feat/attempt')
  })

  it('passes an approval reason when supplied', async () => {
    const api = createMockApi({
      approveRun: vi.fn().mockResolvedValue({
        success: true,
        stage: 'done',
        branch: 'feat/attempt',
        commitSha: 'abc123def',
        pushed: false,
      }),
    })

    const result = await runCommand(['approve', activeRun.id, '--reason', 'reviewed CI and diff'], api)

    expect(result.code).toBe(0)
    expect(api.approveRun).toHaveBeenCalledWith(activeRun.id, { reason: 'reviewed CI and diff' })
  })

  it('passes unattended approval mode only when requested', async () => {
    const api = createMockApi({
      approveRun: vi.fn().mockResolvedValue({
        success: false,
        stage: 'ship',
        reason: 'Needs Attention: unattended approval blocked: remote CI is not green',
      }),
    })

    const result = await runCommand(['approve', activeRun.id, '--unattended'], api)

    expect(result.code).not.toBe(0)
    expect(api.approveRun).toHaveBeenCalledWith(activeRun.id, { unattended: true })
    expect(result.text).toContain('Needs Attention')
  })

  it('retries failed or stalled Attempts through repair', async () => {
    const api = createMockApi()
    const result = await runCommand(['retry', activeRun.id], api)

    expect(result.code).toBe(0)
    expect(api.retryRun).toHaveBeenCalledWith(activeRun.id)
    expect(result.text).toContain(`Attempt ${activeRun.id} marked for retry`)
  })

  it('passes a retry reason when supplied', async () => {
    const api = createMockApi()
    const result = await runCommand(['retry', activeRun.id, '--reason', 'checked logs'], api)

    expect(result.code).toBe(0)
    expect(api.retryRun).toHaveBeenCalledWith(activeRun.id, { reason: 'checked logs' })
  })
})
