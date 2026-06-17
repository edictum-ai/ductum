import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { activeRun, createMockApi, runCommand } from './helpers.js'

describe('cancel command', () => {
  it('cancels a run with an agent-first envelope', async () => {
    const api = createMockApi()
    const result = await runCommand([
      '--json',
      'cancel',
      activeRun.id,
      '--reason',
      'duplicate attempt',
    ], api)

    expect(result.code).toBe(0)
    expect(api.cancelRun).toHaveBeenCalledWith(activeRun.id, {
      reason: 'duplicate attempt',
      cleanupWorktree: false,
    })
    const parsed = JSON.parse(result.text) as Record<string, unknown>
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      kind: 'run.cancelled',
      data: {
        run: { id: activeRun.id, terminalState: 'cancelled' },
        cost: { tokensIn: 10, tokensOut: 20, usd: 1.25 },
        worktreePreserved: true,
      },
    })
  })

  it('passes cleanup-worktree and renders human output', async () => {
    const api = createMockApi({
      cancelRun: vi.fn().mockResolvedValue({
        run: { ...activeRun, terminalState: 'cancelled' as const, worktreePaths: null },
        cost: { tokensIn: 10, tokensOut: 20, usd: 1.25 },
        worktreePreserved: false,
        cleanupAt: '2026-04-04T12:00:00.000Z',
        evidenceId: 'evidence-cancel',
      }),
    })
    const result = await runCommand([
      '--human',
      'cancel',
      activeRun.id,
      '--reason',
      'operator stopped work',
      '--cleanup-worktree',
    ], api)

    expect(result.code).toBe(0)
    expect(api.cancelRun).toHaveBeenCalledWith(activeRun.id, {
      reason: 'operator stopped work',
      cleanupWorktree: true,
    })
    expect(result.text).toContain('result: Cancelled')
    expect(result.text).not.toContain('terminalState')
    expect(result.text).toContain('worktree: removed')
  })

  it('renders help as an agent-first envelope when stdout is not a TTY', async () => {
    const result = await runCommand(['cancel', '--help'])

    expect(result.code).toBe(0)
    const parsed = JSON.parse(result.text) as Record<string, unknown>
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      kind: 'cli.help',
      data: {
        command: 'ductum cancel',
        usage: 'ductum cancel [options] <attemptId>',
      },
    })
  })

  it('renders pretty help when stdout is a TTY', async () => {
    const stdout = new TtyMemoryWritable()
    const result = await runCommand(['cancel', '--help'], createMockApi(), '', { stdout })

    expect(result.code).toBe(0)
    expect(stdout.text()).toContain('Usage: ductum cancel [options] <attemptId>')
    expect(stdout.text()).toContain('--reason <text>')
  })
})

class TtyMemoryWritable extends Writable {
  isTTY = true
  private chunks: Buffer[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}
