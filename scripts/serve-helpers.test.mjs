import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ensureOperatorToken,
  isUsableOperatorToken,
  loadLocalEnv,
  resolveOperatorTokenHomePath,
} from './serve-helpers.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('serve operator token bootstrap', () => {
  it('auto-generates and persists a token when none exists', async () => {
    const dir = tempDir()
    const envPath = join(dir, '.env.local')
    const env = {}

    const result = await ensureOperatorToken({
      env,
      envPath,
      generateToken: () => 'a'.repeat(64),
    })

    expect(result).toMatchObject({ action: 'generated', saved: true })
    expect(env.DUCTUM_OPERATOR_TOKEN).toBe('a'.repeat(64))
    expect(readFileSync(envPath, 'utf-8')).toBe(`DUCTUM_OPERATOR_TOKEN=${'a'.repeat(64)}\n`)
  })

  it('replaces placeholder tokens without dropping other env values', async () => {
    const dir = tempDir()
    const envPath = join(dir, '.env.local')
    writeFileSync(envPath, [
      'TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}',
      'DUCTUM_OPERATOR_TOKEN=replace-me-with-a-long-random-token',
      'TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}',
      '',
    ].join('\n'))

    await ensureOperatorToken({
      env: { DUCTUM_OPERATOR_TOKEN: 'replace-me-with-a-long-random-token' },
      envPath,
      generateToken: () => 'b'.repeat(64),
    })

    const text = readFileSync(envPath, 'utf-8')
    expect(text).toContain(`DUCTUM_OPERATOR_TOKEN=${'b'.repeat(64)}`)
    expect(text).toContain('TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}')
    expect(text).toContain('TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}')
    expect(text).not.toContain('replace-me-with-a-long-random-token')
  })

  it('does not write .env.local when the shell already has a usable token', async () => {
    const dir = tempDir()
    const envPath = join(dir, '.env.local')

    const result = await ensureOperatorToken({
      env: { DUCTUM_OPERATOR_TOKEN: 'already-good' },
      envPath,
      generateToken: () => {
        throw new Error('should not generate')
      },
    })

    expect(result).toMatchObject({ action: 'existing', saved: false })
    expect(existsSync(envPath)).toBe(false)
  })

  it('lets an operator or agent choose a token explicitly', async () => {
    const dir = tempDir()
    const envPath = join(dir, '.env.local')
    const env = {}

    const result = await ensureOperatorToken({
      env,
      envPath,
      requestedToken: 'chosen-token',
      generateToken: () => {
        throw new Error('should not generate')
      },
    })

    expect(result).toMatchObject({ action: 'chosen', saved: true })
    expect(env.DUCTUM_OPERATOR_TOKEN).toBe('chosen-token')
    expect(readFileSync(envPath, 'utf-8')).toBe('DUCTUM_OPERATOR_TOKEN=chosen-token\n')
  })

  it('can persist an existing shell token to both .env.local and ~/.ductum/operator-token', async () => {
    const dir = tempDir()
    const envPath = join(dir, '.env.local')
    const home = join(dir, 'home')
    const homeTokenPath = resolveOperatorTokenHomePath(home)

    const result = await ensureOperatorToken({
      env: { DUCTUM_OPERATOR_TOKEN: 'persist-me' },
      envPath,
      homeTokenPath,
      persistExisting: true,
    })

    expect(result).toMatchObject({ action: 'existing', saved: true, homeTokenPath })
    expect(readFileSync(envPath, 'utf-8')).toBe('DUCTUM_OPERATOR_TOKEN=persist-me\n')
    expect(readFileSync(homeTokenPath, 'utf-8')).toBe('persist-me\n')
  })

  it('rejects documented placeholder values', () => {
    expect(isUsableOperatorToken('replace-me-with-a-long-random-token')).toBe(false)
    expect(isUsableOperatorToken('local-demo-token')).toBe(false)
    expect(isUsableOperatorToken('real-token')).toBe(true)
  })

  it('loads a usable operator token from ~/.ductum/operator-token when .env.local is missing or unusable', () => {
    const dir = tempDir()
    const home = join(dir, 'home')
    mkdirSync(join(home, '.ductum'), { recursive: true })
    writeFileSync(join(home, '.ductum', 'operator-token'), 'from-home\n')
    writeFileSync(join(dir, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=replace-me\n')

    const env = {}
    loadLocalEnv({ cwd: dir, env, operatorTokenPath: join(home, '.ductum', 'operator-token') })

    expect(env.DUCTUM_OPERATOR_TOKEN).toBe('from-home')
  })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-serve-token-'))
  dirs.push(dir)
  return dir
}
