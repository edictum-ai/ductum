import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, seedInitialFactoryDatabase } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { runCommand } from './helpers.js'

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('start command public bind policy', () => {
  it('refuses public binds unless the operator explicitly allows them', async () => {
    const dir = await factoryDir()
    const result = await runCommand(['start', '--dir', dir, '--host', '0.0.0.0', '--dry-run'])

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Refusing to bind Ductum API outside loopback')
  })

  it('refuses local token detect on a public bind before printing a start plan', async () => {
    const dir = await factoryDir()
    const result = await runCommand([
      'start',
      '--dir',
      dir,
      '--host',
      '0.0.0.0',
      '--allow-public-host',
      '--allow-token-detect',
      '--operator-token',
      'operator-secret',
      '--dry-run',
    ])

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Refusing to enable local dashboard reconnect on a non-loopback API bind')
    expect(result.text).toBe('')
    expect(result.errorText).not.toContain('operator-secret')
  })

  it('prints public bind deployment guidance without exposing the operator token', async () => {
    const dir = await factoryDir()
    const result = await runCommand([
      '--human',
      'start',
      '--dir',
      dir,
      '--host',
      '0.0.0.0',
      '--allow-public-host',
      '--operator-token',
      'operator-secret',
      '--dry-run',
    ])

    expect(result.code).toBe(0)
    expect(result.text).toContain('warning: public bind enabled; operator-token detect and browser handoff stay local-only')
    expect(result.text).toContain('deployment: put this API behind TLS plus a trusted reverse proxy or tunnel before remote access')
    expect(result.text).toContain('browser handoff: disabled for this bind host')
    expect(result.text).not.toContain('operator-secret')
  })
})

async function factoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-start-test-'))
  tmpDirs.push(dir)
  await mkdir(dir, { recursive: true })
  const db = initDb(join(dir, 'ductum.db'))
  seedInitialFactoryDatabase({ db, factoryDir: dir, projectName: 'factory', agents: [] })
  db.close()
  await writeFile(join(dir, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=existing-token\n')
  return dir
}
