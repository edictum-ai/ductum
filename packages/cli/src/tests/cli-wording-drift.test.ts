import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runCommand } from './helpers.js'

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('operator CLI wording drift', () => {
  it('keeps init help and init errors off the old seed wording', async () => {
    const help = await runCommand(['init', '--help'])
    const dir = await mkdtemp(join(tmpdir(), 'ductum-wording-init-'))
    tmpDirs.push(dir)
    const error = await runCommand(['--json', 'init', '--dir', dir, '--name', 'Factory'])

    expect(help.code).toBe(0)
    expect(help.text).toContain('Create a local Ductum factory directory and apply its initial configuration')
    expect(help.text).not.toContain('Failed to seed the new factory API')
    expect(help.text.toLowerCase()).not.toContain('seed')

    expect(error.code).toBe(1)
    expect(error.errorText).not.toContain('Failed to seed the new factory API')
    expect(error.errorText.toLowerCase()).not.toContain('seed')
  })

  it('keeps spec import help and contract errors on Task/Attempt wording', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ductum-wording-import-'))
    tmpDirs.push(dir)
    const file = join(dir, 'weak.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: weak-import',
      'tasks:',
      '  - name: plan',
      '    prompt: Plan the work.',
      '',
    ].join('\n'), 'utf8')

    const help = await runCommand(['spec', 'import', '--help'])
    const blocked = await runCommand(['spec', 'import', file])

    expect(help.code).toBe(0)
    expect(help.text).toContain('Attempt history stays separate')
    expect(help.text).not.toContain('recorded run')
    expect(help.text).not.toContain('recorded runs')

    expect(blocked.code).toBe(1)
    expect(blocked.text).toContain('This import creates Tasks only; it does not backfill Attempt history.')
    expect(blocked.text).not.toContain('recorded run')
    expect(blocked.text).not.toContain('recorded runs')
  })
})
