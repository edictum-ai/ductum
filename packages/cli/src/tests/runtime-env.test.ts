import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadLocalEnv } from '../runtime.js'
import { resolveCliApiUrl } from '../runtime-env.js'

describe('CLI local env loading', () => {
  it('loads .env.local without overriding exported shell values', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-env-'))
    try {
      writeFileSync(join(root, '.env'), [
        'DUCTUM_OPERATOR_TOKEN=from-env',
        'TELEGRAM_BOT_TOKEN=from-env',
      ].join('\n'))
      writeFileSync(join(root, '.env.local'), [
        'DUCTUM_OPERATOR_TOKEN=from-local',
        'TELEGRAM_CHAT_ID=\"12345\"',
        'export TELEGRAM_WEBHOOK_SECRET=secret-from-local',
      ].join('\n'))

      const env: Record<string, string | undefined> = { HOME: root, TELEGRAM_BOT_TOKEN: 'from-shell' }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-local')
      expect(env.TELEGRAM_BOT_TOKEN).toBe('from-shell')
      expect(env.TELEGRAM_CHAT_ID).toBe('12345')
      expect(env.TELEGRAM_WEBHOOK_SECRET).toBe('secret-from-local')
      expect(loaded).toContain('DUCTUM_OPERATOR_TOKEN')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to ~/.ductum/operator-token when local env files do not provide a usable token', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-home-token-'))
    try {
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=replace-me\n')
      writeFileSync(join(root, '.ductum', 'operator-token'), 'from-home\n')

      const env: Record<string, string | undefined> = { HOME: root }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-home')
      expect(loaded).toContain('DUCTUM_OPERATOR_TOKEN')
      expect(loaded.filter((key) => key === 'DUCTUM_OPERATOR_TOKEN')).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads the persisted operator token before the implicit factory token', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-factory-token-'))
    try {
      const factoryDir = join(root, 'factory')
      mkdirSync(join(factoryDir, '.ductum'), { recursive: true })
      writeFileSync(join(factoryDir, '.ductum', 'operator-token'), 'from-factory\n')
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.ductum', 'operator-token'), 'from-home\n')

      const env: Record<string, string | undefined> = { HOME: root, DUCTUM_FACTORY_DATA_DIR: factoryDir }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-home')
      expect(loaded).toContain('DUCTUM_OPERATOR_TOKEN')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads persisted API URL config when no explicit env URL exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-api-url-'))
    try {
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.ductum', 'config.json'), '{"apiUrl":"http://127.0.0.1:4777/"}\n')

      const env: Record<string, string | undefined> = { HOME: root }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_API_URL).toBe('http://127.0.0.1:4777')
      expect(resolveCliApiUrl(undefined, env)).toBe('http://127.0.0.1:4777')
      expect(loaded).toContain('DUCTUM_API_URL')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads persisted API URL config before implicit factory env files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-api-url-factory-'))
    try {
      const factoryDir = join(root, 'factory')
      mkdirSync(factoryDir, { recursive: true })
      writeFileSync(join(factoryDir, '.env.local'), 'DUCTUM_API_URL=http://127.0.0.1:4888\n')
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.ductum', 'config.json'), '{"apiUrl":"http://127.0.0.1:4777"}\n')

      const env: Record<string, string | undefined> = { HOME: root, DUCTUM_FACTORY_DATA_DIR: factoryDir }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_API_URL).toBe('http://127.0.0.1:4777')
      expect(resolveCliApiUrl(undefined, env)).toBe('http://127.0.0.1:4777')
      expect(loaded.filter((key) => key === 'DUCTUM_API_URL')).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps explicit shell token and API URL before persisted config', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-explicit-env-'))
    try {
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.ductum', 'operator-token'), 'from-home\n')
      writeFileSync(join(root, '.ductum', 'config.json'), '{"apiUrl":"http://127.0.0.1:4777"}\n')

      const env: Record<string, string | undefined> = {
        HOME: root,
        DUCTUM_OPERATOR_TOKEN: 'from-shell',
        DUCTUM_API_URL: 'http://127.0.0.1:4999',
      }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-shell')
      expect(env.DUCTUM_API_URL).toBe('http://127.0.0.1:4999')
      expect(loaded).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves API URL precedence from explicit flag, env, derived port, then default', () => {
    expect(resolveCliApiUrl('https://factory.example/api/', {})).toBe('https://factory.example/api')
    expect(resolveCliApiUrl(undefined, { DUCTUM_API_URL: 'http://127.0.0.1:4777/' })).toBe('http://127.0.0.1:4777')
    expect(resolveCliApiUrl(undefined, { DUCTUM_HOST: '0.0.0.0', DUCTUM_PORT: '4555' })).toBe('http://127.0.0.1:4555')
    expect(resolveCliApiUrl(undefined, {})).toBe('http://localhost:4100')
  })

  it('uses the persisted operator token before a stale .env.local token', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-local-token-'))
    try {
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=from-local\n')
      writeFileSync(join(root, '.ductum', 'operator-token'), 'from-home\n')

      const env: Record<string, string | undefined> = { HOME: root }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-home')
      expect(loaded.filter((key) => key === 'DUCTUM_OPERATOR_TOKEN')).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores missing env files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-env-empty-'))
    try {
      mkdirSync(join(root, 'nested'))
      const home = join(root, 'home')
      mkdirSync(home)
      const env: Record<string, string | undefined> = { HOME: home }
      expect(loadLocalEnv({ cwd: join(root, 'nested'), env })).toEqual([])
      expect(env).toEqual({ HOME: home })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
