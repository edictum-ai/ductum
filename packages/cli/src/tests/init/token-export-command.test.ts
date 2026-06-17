import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { renderTokenExportCommand } from '../../init/steps/browser-handoff.js'

describe('init token export command', () => {
  it('exports the operator token by reading the local token file', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-token-export-'))
    try {
      const tokenPath = join(root, '.ductum', 'operator-token')
      mkdirSync(join(root, '.ductum'), { recursive: true })
      writeFileSync(tokenPath, 'test-token\n', { mode: 0o600 })

      const command = renderTokenExportCommand(tokenPath)
      const output = execFileSync('sh', ['-c', `${command} && printf '%s' "$DUCTUM_OPERATOR_TOKEN"`], {
        encoding: 'utf8',
      })

      expect(command).toContain(`export DUCTUM_OPERATOR_TOKEN="$(cat '${tokenPath}')";`)
      expect(command).not.toContain('test-token')
      expect(output).toBe('test-token')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prints the exact missing token path and next step when the file is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-token-missing-'))
    try {
      const tokenPath = join(root, '.ductum', 'operator-token')
      const command = renderTokenExportCommand(tokenPath)
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
