import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { createMockApi, runCommand } from './helpers.js'
import { runCli } from '../program.js'
import { loadLocalEnv } from '../runtime.js'

describe('ductum config command', () => {
  it('stores an operator token without echoing it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-config-token-'))
    try {
      const result = await runCommand(['config', 'token', 'set', 'secret-token'], createMockApi(), '', {
        env: { HOME: home },
      })

      const tokenPath = join(home, '.ductum', 'operator-token')
      expect(result.code).toBe(0)
      expect(result.text).toContain(`Stored access file: ${tokenPath}`)
      expect(result.text).not.toContain('secret-token')
      expect(readFileSync(tokenPath, 'utf8')).toBe('secret-token\n')
      expect((statSync(tokenPath).mode & 0o777).toString(8)).toBe('600')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('stores an operator token from stdin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-config-token-stdin-'))
    try {
      const result = await runCommand(['config', 'token', 'set', '--stdin'], createMockApi(), 'stdin-token\n', {
        env: { HOME: home },
      })

      expect(result.code).toBe(0)
      expect(readFileSync(join(home, '.ductum', 'operator-token'), 'utf8')).toBe('stdin-token\n')
      expect(result.text).not.toContain('stdin-token')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('stores and shows the default API URL', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-config-api-url-'))
    try {
      const set = await runCommand(['config', 'api-url', 'set', 'http://127.0.0.1:4777/'], createMockApi(), '', {
        env: { HOME: home },
      })
      const show = await runCommand(['config', 'show'], createMockApi(), '', { env: { HOME: home } })

      expect(set.code).toBe(0)
      expect(set.text).toContain('Stored API URL: http://127.0.0.1:4777')
      expect(readFileSync(join(home, '.ductum', 'config.json'), 'utf8')).toContain('"apiUrl": "http://127.0.0.1:4777"')
      expect(show.text).toContain('apiUrl: http://127.0.0.1:4777')
      expect(show.text).toContain('access: not configured')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses the persisted API URL for normal commands', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-config-api-default-'))
    try {
      const env: Record<string, string | undefined> = { HOME: home }
      await runCommand(['config', 'api-url', 'set', 'http://127.0.0.1:4777'], createMockApi(), '', { env })
      loadLocalEnv({ cwd: home, env })

      const seenUrls: string[] = []
      const stdout = new MemoryWritable()
      const stderr = new MemoryWritable()
      const code = await runCli(['node', 'ductum', 'status'], {
        env,
        stdout,
        stderr,
        stdin: Readable.from(''),
        createApi: (apiUrl) => {
          seenUrls.push(apiUrl)
          return createMockApi()
        },
        now: () => new Date('2026-04-04T12:00:00.000Z'),
      })

      expect(code).toBe(0)
      expect(seenUrls).toEqual(['http://127.0.0.1:4777'])
      expect(stderr.toString()).toBe('')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports invalid API URLs loudly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-config-api-invalid-'))
    try {
      const result = await runCommand(['config', 'api-url', 'set', 'file:///tmp/socket'], createMockApi(), '', {
        env: { HOME: home },
      })

      expect(result.code).toBe(1)
      expect(result.errorText).toContain('API URL must use http or https')
      expect(existsSync(join(home, '.ductum', 'config.json'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

class MemoryWritable extends Writable {
  private chunks: string[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString())
    callback()
  }

  toString() {
    return this.chunks.join('')
  }
}
