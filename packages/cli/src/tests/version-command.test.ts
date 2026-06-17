import { describe, expect, it } from 'vitest'

import { runCommand } from './helpers.js'

describe('version command', () => {
  it('prints the CLI version as text', async () => {
    const result = await runCommand(['--version'])
    expect(result.text).toMatch(/^0\.1\.0\n$/)
  })

  it('prints the CLI version as a D135 envelope with --json', async () => {
    const result = await runCommand(['--json', '--version'])
    const envelope = JSON.parse(result.text) as {
      schemaVersion: number
      kind: string
      data: { version: string }
    }
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      kind: 'cli.version',
      data: { version: '0.1.0' },
    })
  })
})
