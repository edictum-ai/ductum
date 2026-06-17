import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadLocalEnv } from '../runtime.js'

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

      const env: Record<string, string | undefined> = { TELEGRAM_BOT_TOKEN: 'from-shell' }
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

  it('keeps a usable .env.local token instead of overwriting it from ~/.ductum/operator-token', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-cli-local-token-'))
    try {
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(join(root, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=from-local\n')
      writeFileSync(join(root, '.ductum', 'operator-token'), 'from-home\n')

      const env: Record<string, string | undefined> = { HOME: root }
      const loaded = loadLocalEnv({ cwd: root, env })

      expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-local')
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
