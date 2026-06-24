import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, afterEach, vi } from 'vitest'

import { createMockApi, DuctumApiError, factorySecret, runCommand } from './helpers.js'

const tempDirs: string[] = []
const SECRET_VALUE = JSON.stringify({
  mode: 'github_app',
  appId: '123',
  installationId: '456',
  privateKey: 'fake-private-key-marker',
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ductum factory secret commands', () => {
  it('lists factory secrets without printing plaintext', async () => {
    const result = await runCommand(['factory', 'secret', 'list'], createMockApi())

    expect(result.code).toBe(0)
    expect(result.text).toContain(factorySecret.id)
    expect(result.text).toContain(factorySecret.name)
    expect(result.text).toContain(factorySecret.scope)
    expectNoSecretLeak(result, SECRET_VALUE)
  })

  it('creates a secret from --value-file without printing plaintext', async () => {
    const valueFile = secretFile(SECRET_VALUE)
    const api = createMockApi({
      createFactorySecret: vi.fn().mockResolvedValue(factorySecret),
    })

    const result = await runCommand([
      'factory',
      'secret',
      'create',
      '--name',
      'github-app',
      '--value-file',
      valueFile,
    ], api)

    expect(result.code).toBe(0)
    expect(api.createFactorySecret).toHaveBeenCalledWith({
      name: 'github-app',
      value: SECRET_VALUE,
    })
    expect(result.text).toContain(factorySecret.id)
    expectNoSecretLeak(result, SECRET_VALUE)
  })

  it('creates a secret from --value-stdin and keeps JSON output redacted', async () => {
    const api = createMockApi({
      createFactorySecret: vi.fn().mockResolvedValue(factorySecret),
    })

    const result = await runCommand([
      '--json',
      'factory',
      'secret',
      'create',
      '--name',
      'github-app',
      '--value-stdin',
    ], api, SECRET_VALUE)

    expect(result.code).toBe(0)
    expect(api.createFactorySecret).toHaveBeenCalledWith({
      name: 'github-app',
      value: SECRET_VALUE,
    })
    expect(JSON.parse(result.text)).toMatchObject({
      id: factorySecret.id,
      name: factorySecret.name,
      scope: factorySecret.scope,
    })
    expectNoSecretLeak(result, SECRET_VALUE)
  })

  it('updates a secret from --value-file without printing plaintext', async () => {
    const rotatedValue = `${SECRET_VALUE}\n`
    const valueFile = secretFile(rotatedValue)
    const updated = { ...factorySecret, name: 'github-app-rotated' }
    const api = createMockApi({
      updateFactorySecret: vi.fn().mockResolvedValue(updated),
    })

    const result = await runCommand([
      'factory',
      'secret',
      'update',
      factorySecret.id,
      '--name',
      'github-app-rotated',
      '--value-file',
      valueFile,
    ], api)

    expect(result.code).toBe(0)
    expect(api.updateFactorySecret).toHaveBeenCalledWith(factorySecret.id, {
      name: 'github-app-rotated',
      value: rotatedValue,
    })
    expect(result.text).toContain('github-app-rotated')
    expectNoSecretLeak(result, SECRET_VALUE, rotatedValue)
  })

  it('updates a secret from --value-stdin without printing plaintext', async () => {
    const api = createMockApi({
      updateFactorySecret: vi.fn().mockResolvedValue(factorySecret),
    })

    const result = await runCommand([
      'factory',
      'secret',
      'update',
      factorySecret.id,
      '--value-stdin',
    ], api, SECRET_VALUE)

    expect(result.code).toBe(0)
    expect(api.updateFactorySecret).toHaveBeenCalledWith(factorySecret.id, {
      value: SECRET_VALUE,
    })
    expectNoSecretLeak(result, SECRET_VALUE)
  })

  it('tests and deletes a secret with metadata-only output', async () => {
    const tested = { ...factorySecret, lastTestedAt: '2026-04-05T00:00:00.000Z' }
    const api = createMockApi({
      getFactorySecret: vi.fn().mockResolvedValue(factorySecret),
      testFactorySecret: vi.fn().mockResolvedValue(tested),
      deleteFactorySecret: vi.fn().mockResolvedValue(undefined),
    })

    const testedResult = await runCommand(['factory', 'secret', 'test', factorySecret.id], api)
    const deletedResult = await runCommand(['factory', 'secret', 'delete', factorySecret.id], api)

    expect(testedResult.code).toBe(0)
    expect(deletedResult.code).toBe(0)
    expect(api.testFactorySecret).toHaveBeenCalledWith(factorySecret.id)
    expect(api.getFactorySecret).toHaveBeenCalledWith(factorySecret.id)
    expect(api.deleteFactorySecret).toHaveBeenCalledWith(factorySecret.id)
    expectNoSecretLeak(testedResult, SECRET_VALUE)
    expectNoSecretLeak(deletedResult, SECRET_VALUE)
  })

  it('rejects plaintext --value input without echoing the secret', async () => {
    const result = await runCommand([
      'factory',
      'secret',
      'create',
      '--name',
      'github-app',
      '--value',
      SECRET_VALUE,
    ], createMockApi())

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Plaintext secret values on the command line are rejected')
    expectNoSecretLeak(result, SECRET_VALUE)
  })

  it('redacts plaintext if the API error details echo it back', async () => {
    const valueFile = secretFile(SECRET_VALUE)
    const api = createMockApi({
      createFactorySecret: vi.fn().mockRejectedValue(
        new DuctumApiError('Secret validation failed', 400, { submittedValue: SECRET_VALUE }),
      ),
    })

    const result = await runCommand([
      'factory',
      'secret',
      'create',
      '--name',
      'github-app',
      '--value-file',
      valueFile,
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Secret validation failed')
    expectNoSecretLeak(result, SECRET_VALUE)
  })
})

function secretFile(value: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-secret-command-'))
  tempDirs.push(dir)
  const file = join(dir, 'github-app.json')
  writeFileSync(file, value, 'utf8')
  return file
}

function expectNoSecretLeak(
  result: { stdout: string; stderr: string; text: string; errorText: string },
  ...secretValues: string[]
) {
  for (const secret of secretValues) {
    expect(result.stdout).not.toContain(secret)
    expect(result.stderr).not.toContain(secret)
    expect(result.text).not.toContain(secret)
    expect(result.errorText).not.toContain(secret)
  }
}
