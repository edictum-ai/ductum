import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createHostPreflightProbes } from '../workspace-preflight.js'

const cleanup: Array<() => void> = []

afterEach(() => {
  for (const entry of cleanup.splice(0)) entry()
})

describe('workspace preflight host probes', () => {
  it('resolves tools from the agent PATH without requiring which on that PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-preflight-probes-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const tool = join(dir, 'ductum-test-tool')
    writeFileSync(tool, '#!/bin/sh\nprintf "tool 1.2.3\\n"\n')
    chmodSync(tool, 0o755)
    const probes = createHostPreflightProbes({ PATH: dir })

    expect(probes.hasBinary('ductum-test-tool')).toBe(true)
    expect(probes.binaryVersion('ductum-test-tool')).toBe('tool 1.2.3')
  })
})
