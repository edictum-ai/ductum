import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { renderCliConfigCommand } from '../../init/steps/browser-handoff.js'

describe('init CLI config command', () => {
  it('persists the API URL and operator token by reading the local token file', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-token-config-'))
    try {
      const tokenPath = join(root, '.ductum', 'operator-token')
      const binDir = join(root, 'bin')
      const apiOut = join(root, 'api-url.out')
      const tokenOut = join(root, 'token.out')
      mkdirSync(join(root, '.ductum'), { recursive: true })
      mkdirSync(binDir)
      writeFileSync(tokenPath, 'test-token\n', { mode: 0o600 })
      writeFileSync(join(binDir, 'ductum'), [
        '#!/bin/sh',
        'if [ "$1 $2 $3" = "config api-url set" ]; then',
        '  printf "%s" "$4" > "$DUCTUM_FAKE_API_OUT"',
        '  exit 0',
        'fi',
        'if [ "$1 $2 $3 $4" = "config token set --stdin" ]; then',
        '  cat > "$DUCTUM_FAKE_TOKEN_OUT"',
        '  exit 0',
        'fi',
        'exit 2',
        '',
      ].join('\n'), { mode: 0o755 })

      const command = renderCliConfigCommand(tokenPath, 'http://127.0.0.1:4777')
      execFileSync('sh', ['-c', command], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          DUCTUM_FAKE_API_OUT: apiOut,
          DUCTUM_FAKE_TOKEN_OUT: tokenOut,
        },
      })

      expect(command).toContain("ductum config api-url set 'http://127.0.0.1:4777'")
      expect(command).toContain(`ductum config token set --stdin < '${tokenPath}'`)
      expect(command).not.toContain('test-token')
      expect(readFileSync(apiOut, 'utf8')).toBe('http://127.0.0.1:4777')
      expect(readFileSync(tokenOut, 'utf8')).toBe('test-token\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prints the exact missing token path and next step when the file is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-token-missing-'))
    try {
      const tokenPath = join(root, '.ductum', 'operator-token')
      const command = renderCliConfigCommand(tokenPath, 'http://127.0.0.1:4777')
      let stderr = ''
      try {
        execFileSync('sh', ['-c', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr ?? '')
        expect((error as { status?: number }).status).toBe(1)
      }

      expect(stderr).toContain(`Ductum operator token file missing: ${tokenPath}`)
      expect(stderr).toContain('Run ductum init --no-login --no-browser again')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
