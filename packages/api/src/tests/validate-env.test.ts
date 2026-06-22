import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'

let mockedHomedir: string | null = null
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => (mockedHomedir != null ? mockedHomedir : actual.homedir()),
  }
})

import { validateEnv, type DuctumConfig } from '../validate-env.js'

describe('validateEnv', () => {
  const originalEnv = { ...process.env }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: MockInstance<any>

  beforeEach(() => {
    process.env = { ...originalEnv }
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    // Isolate from any real ~/.claude/.credentials.json on the dev machine.
    mockedHomedir = join(tmpdir(), `validate-env-empty-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(() => {
    process.env = originalEnv
    exitSpy.mockRestore()
    mockedHomedir = null
  })

  it('requires Anthropic auth when claude-agent-sdk harness is configured', () => {
    clearAnthropicEnv()
    const config: DuctumConfig = {
      agents: {
        mimi: { harness: 'claude-agent-sdk' },
      },
    }

    expect(() => validateEnv(config)).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('does not require Anthropic auth when only non-Claude agents are configured', () => {
    clearAnthropicEnv()
    const config: DuctumConfig = {
      agents: {
        codex: { harness: 'codex-app-server' },
      },
    }

    expect(() => validateEnv(config)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('does not require Anthropic auth when only codex-sdk agents are configured', () => {
    clearAnthropicEnv()
    const config: DuctumConfig = {
      agents: {
        codex: { harness: 'codex-sdk' },
      },
    }

    expect(() => validateEnv(config)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('passes when ANTHROPIC_API_KEY is set for claude-agent-sdk harness', () => {
    clearAnthropicEnv()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const config: DuctumConfig = {
      agents: {
        mimi: { harness: 'claude-agent-sdk' },
      },
    }

    expect(() => validateEnv(config)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('passes when ANTHROPIC_OAUTH_TOKEN is set for claude-agent-sdk harness', () => {
    clearAnthropicEnv()
    process.env.ANTHROPIC_OAUTH_TOKEN = 'oauth-test'
    const config: DuctumConfig = {
      agents: {
        mimi: { harness: 'claude-agent-sdk' },
      },
    }

    expect(() => validateEnv(config)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('passes when ambient $CLAUDE_CONFIG_DIR/credentials.json provides Claude oauth (D159)', () => {
    clearAnthropicEnv()
    const dir = makeTempDir('validate-env-creds')
    try {
      writeFileSync(join(dir, 'credentials.json'), JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-oat01-fake-but-truthy',
          expiresAt: 9999999999999,
          refreshToken: 'sk-ant-ort01-fake-but-truthy',
        },
      }))
      mockedHomedir = dir
      process.env.CLAUDE_CONFIG_DIR = dir
      const config: DuctumConfig = {
        agents: {
          mimi: { harness: 'claude-agent-sdk' },
        },
      }

      expect(() => validateEnv(config)).not.toThrow()
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still fails when credentials.json is malformed JSON (D159)', () => {
    clearAnthropicEnv()
    const dir = makeTempDir('validate-env-bad')
    try {
      writeFileSync(join(dir, 'credentials.json'), 'not json {')
      mockedHomedir = dir
      process.env.CLAUDE_CONFIG_DIR = dir
      const config: DuctumConfig = {
        agents: {
          mimi: { harness: 'claude-agent-sdk' },
        },
      }

      expect(() => validateEnv(config)).toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still fails when credentials.json has empty token strings (D159)', () => {
    clearAnthropicEnv()
    const dir = makeTempDir('validate-env-empty')
    try {
      writeFileSync(join(dir, 'credentials.json'), JSON.stringify({
        claudeAiOauth: { accessToken: '', refreshToken: '' },
      }))
      mockedHomedir = dir
      process.env.CLAUDE_CONFIG_DIR = dir
      const config: DuctumConfig = {
        agents: {
          mimi: { harness: 'claude-agent-sdk' },
        },
      }

      expect(() => validateEnv(config)).toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid DUCTUM_PORT (non-numeric)', () => {
    process.env.DUCTUM_PORT = 'abc'
    const config: DuctumConfig = { agents: {} }

    expect(() => validateEnv(config)).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('rejects DUCTUM_PORT out of range (0)', () => {
    process.env.DUCTUM_PORT = '0'
    const config: DuctumConfig = { agents: {} }

    expect(() => validateEnv(config)).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('rejects DUCTUM_PORT out of range (99999)', () => {
    process.env.DUCTUM_PORT = '99999'
    const config: DuctumConfig = { agents: {} }

    expect(() => validateEnv(config)).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('accepts valid DUCTUM_PORT', () => {
    process.env.DUCTUM_PORT = '4100'
    const config: DuctumConfig = { agents: {} }

    expect(() => validateEnv(config)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('does not require DUCTUM_PORT when not set', () => {
    delete process.env.DUCTUM_PORT
    const config: DuctumConfig = { agents: {} }

    expect(() => validateEnv(config)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

function clearAnthropicEnv(): void {
  delete process.env.ANTHROPIC_OAUTH_TOKEN
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CONFIG_DIR
}

function makeTempDir(prefix: string): string {
  const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(path, { recursive: true })
  return path
}
