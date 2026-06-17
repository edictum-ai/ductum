import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockApi, runCommand } from './helpers.js'

describe('spec import contract gate', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ductum-import-contract-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('blocks task import when a spec lacks Decision Trace and contract coverage', async () => {
    const file = join(tmpDir, 'weak.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: weak-import',
      'tasks:',
      '  - name: plan',
      '    prompt: Plan the work.',
      '',
    ].join('\n'), 'utf8')
    const api = createMockApi()

    const result = await runCommand(['spec', 'import', file], api)

    expect(result.code).toBe(1)
    expect(result.text).toContain('Blocked: contract incomplete; task import not run.')
    expect(result.text).toContain('ductum spec intake ductum')
    expect(result.text).toContain('ductum spec import')
    expect(result.text).toContain('--waive-contract')
    expect(result.errorText).toContain('Spec weak-import contract is incomplete; import not run')
    expect(api.createSpec).not.toHaveBeenCalled()
    expect(api.createTask).not.toHaveBeenCalled()
  })

  it('keeps JSON parseable when spec import is blocked by the contract gate', async () => {
    const file = join(tmpDir, 'weak-json.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: weak-json-import',
      'tasks:',
      '  - name: plan',
      '    prompt: Plan the work.',
      '',
    ].join('\n'), 'utf8')

    const result = await runCommand(['--json', 'spec', 'import', file])
    const payload = JSON.parse(result.stdout) as {
      blocked: boolean
      contract: { incomplete: boolean }
      nextCommands: string[]
    }

    expect(result.code).toBe(1)
    expect(payload.blocked).toBe(true)
    expect(payload.contract.incomplete).toBe(true)
    expect(payload.nextCommands.some((command) => command.includes('--waive-contract'))).toBe(true)
    expect(result.errorText).toContain('Spec weak-json-import contract is incomplete; import not run')
  })
})
