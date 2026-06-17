import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readClaudeCredentials, resolveClaudeCredentialsPath, writeClaudeCredentials } from '../../login/claude-credentials.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Claude credentials storage', () => {
  it('resolves the Claude config path from HOME or CLAUDE_CONFIG_DIR', () => {
    const home = tempDir()
    const configDir = join(home, 'claude-config')

    expect(resolveClaudeCredentialsPath({ HOME: home })).toBe(join(home, '.claude', '.credentials.json'))
    expect(resolveClaudeCredentialsPath({ HOME: home, CLAUDE_CONFIG_DIR: configDir })).toBe(join(configDir, 'credentials.json'))
  })

  it('writes and overwrites credentials with mode 0600', async () => {
    const home = tempDir()
    const path = resolveClaudeCredentialsPath({ HOME: home })
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(path, '{"claudeAiOauth":{"accessToken":"old"}}\n')
    chmodSync(path, 0o644)

    await writeClaudeCredentials(path, { access: 'access-new', refresh: 'refresh-new', expires: 123 })

    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readClaudeCredentials(path)).toMatchObject({
      claudeAiOauth: { accessToken: 'access-new', refreshToken: 'refresh-new' },
    })
    expect(readdirSync(join(home, '.claude')).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-claude-creds-'))
  dirs.push(dir)
  return dir
}
