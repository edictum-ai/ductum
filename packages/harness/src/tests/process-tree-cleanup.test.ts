import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { asKillTarget, isHostProcessLaunchAlive, ownershipForPlatform, spawnHostExternalCliProcess, terminateProcessTree } from '../process-tree-cleanup.js'

const cleanup: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

describe('process-tree cleanup', () => {
  it('falls back to direct-child ownership only on unsupported platforms', () => {
    expect(ownershipForPlatform('win32')).toEqual({
      kind: 'direct-child',
      pid: null,
      unsupportedReason: 'detached process-group cleanup is unsupported on win32',
    })
    expect(ownershipForPlatform('linux')).toEqual({ kind: 'process-group', pid: null })
  })

  it('escalates from SIGTERM to SIGKILL after the grace timeout', async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number }> = []
    let exitListener: (() => void) | null = null
    const child = {
      pid: 321,
      kill: () => true,
      once: (_event: 'exit', listener: () => void) => { exitListener = listener },
      removeListener: () => {},
    }

    const result = await terminateProcessTree(child, { kind: 'process-group', pid: 321 }, {
      gracePeriodMs: 5,
      forceKillWaitMs: 5,
      sendSignal: (pid, signal) => {
        signals.push({ pid, signal })
        if (signal === 'SIGKILL') setTimeout(() => exitListener?.(), 0)
      },
    })

    expect(result).toMatchObject({ escalated: true, exited: true, ownership: { kind: 'process-group', pid: 321 } })
    expect(signals).toEqual([
      { pid: -321, signal: 'SIGTERM' },
      { pid: -321, signal: 'SIGKILL' },
    ])
  })

  it('does not signal a child that already exited', async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number }> = []
    const child = {
      pid: 321,
      exitCode: 0,
      signalCode: null,
      kill: () => true,
      once: () => {},
      removeListener: () => {},
    }

    const result = await terminateProcessTree(child, { kind: 'process-group', pid: 321 }, {
      sendSignal: (pid, signal) => {
        signals.push({ pid, signal })
      },
    })

    expect(result).toMatchObject({ escalated: false, exited: true })
    expect(signals).toEqual([])
  })

  it('reports a tracked child with an exit status as not alive', () => {
    const child = {
      pid: null,
      exitCode: 1,
      signalCode: null,
    }

    expect(isHostProcessLaunchAlive({
      child: child as never,
      ownership: { kind: 'direct-child', pid: null },
    })).toBe(false)
  })

  it('kills a spawned grandchild when the parent ignores SIGTERM', async () => {
    if (process.platform === 'win32') return

    const tempDir = mkdtempSync(join(tmpdir(), 'ductum-process-tree-'))
    cleanup.push(() => rmSync(tempDir, { recursive: true, force: true }))
    const grandchildPidFile = join(tempDir, 'grandchild.pid')

    const launched = spawnHostExternalCliProcess(process.execPath, ['-e', `
      const fs = require('node:fs')
      const { spawn } = require('node:child_process')
      const pidFile = process.argv[1]
      const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], { stdio: 'ignore' })
      fs.writeFileSync(pidFile, String(grandchild.pid))
      process.on('SIGTERM', () => {})
      setInterval(() => {}, 1000)
    `, grandchildPidFile], {
      cwd: tempDir,
      env: process.env,
    })

    const grandchildPid = await waitForGrandchildPid(grandchildPidFile)
    expect(isProcessAlive(grandchildPid)).toBe(true)

    const result = await terminateProcessTree(asKillTarget(launched.child), launched.ownership, {
      gracePeriodMs: 20,
      forceKillWaitMs: 200,
    })

    expect(result.escalated).toBe(true)
    await waitForProcessExit(grandchildPid)
    expect(isProcessAlive(grandchildPid)).toBe(false)
  })
})

async function waitForGrandchildPid(filePath: string): Promise<number> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      const pid = Number(readFileSync(filePath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) return pid
    } catch {
      // Wait for the child to write the pid file.
    }
    await delay(10)
  }
  throw new Error('Timed out waiting for grandchild pid file')
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    await delay(10)
  }
  throw new Error(`Timed out waiting for process ${pid} to exit`)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
