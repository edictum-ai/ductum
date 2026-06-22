import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ExtensionRegistry } from '../extension-registry.js'
import { loadAllowlistedExtensionManifests } from '../extension-manifest-loader.js'
import { listBuiltInHarnessRegistrations, loadBuiltInHarnessAdapters } from '../registry.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('built-in harness registry', () => {
  it('exposes the current built-in harness ids once through the registry', () => {
    expect(listBuiltInHarnessRegistrations().map((item) => item.id)).toEqual([
      'claude-agent-sdk',
      'codex-app-server',
      'codex-sdk',
      'copilot-sdk',
    ])
    expect(listBuiltInHarnessRegistrations().map((item) => item.manifest)).toEqual([
      expect.objectContaining({ id: 'claude-agent-sdk', kind: 'harness', source: 'built-in' }),
      expect.objectContaining({ id: 'codex-app-server', kind: 'harness', source: 'built-in' }),
      expect.objectContaining({ id: 'codex-sdk', kind: 'harness', source: 'built-in' }),
      expect.objectContaining({ id: 'copilot-sdk', kind: 'harness', source: 'built-in' }),
    ])
  })

  it('loads adapters and preserves operator-facing load messages', () => {
    const loaded = loadBuiltInHarnessAdapters({ apiUrl: 'http://ductum.test' })

    expect([...loaded.adapters.keys()]).toEqual([
      'claude-agent-sdk',
      'codex-app-server',
      'codex-sdk',
      'copilot-sdk',
    ])
    expect(loaded.loaded.map((item) => item.loadMessage)).toEqual([
      'Harness: claude-agent-sdk loaded',
      'Harness: codex-app-server loaded (with Edictum enforcement)',
      'Harness: codex-sdk loaded (compat via codex-app-server enforcement)',
      'Harness: copilot-sdk loaded (GitHub Copilot CLI via JSON-RPC)',
    ])
  })

  it('can swap every built-in adapter into deterministic mock-agent mode', () => {
    const loaded = loadBuiltInHarnessAdapters({
      apiUrl: 'http://ductum.test',
      mockAgentCalls: true,
    })

    expect([...loaded.adapters.keys()]).toEqual([
      'claude-agent-sdk',
      'codex-app-server',
      'codex-sdk',
      'copilot-sdk',
    ])
    expect(loaded.loaded.map((item) => item.loadMessage)).toEqual([
      'Harness: claude-agent-sdk loaded (mock agent calls)',
      'Harness: codex-app-server loaded (mock agent calls)',
      'Harness: codex-sdk loaded (mock agent calls)',
      'Harness: copilot-sdk loaded (mock agent calls)',
    ])
  })

  it('rejects duplicate extension manifests', () => {
    const registry = new ExtensionRegistry()
    const registration = {
      manifest: { id: 'local-file', kind: 'notifier' as const, source: 'operator-allowlisted' as const, capabilities: [] },
      loadMessage: 'loaded',
    }

    registry.register(registration)

    expect(() => registry.register(registration)).toThrow('Duplicate notifier extension: local-file')
  })

  it('loads an operator-allowlisted manifest path into the registry without executing code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-ext-'))
    cleanup.push(dir)
    writeManifest(dir, {
      schemaVersion: 'ductum.extension.v1',
      id: 'com.example.local-notifier',
      kind: 'notifier',
      entrypoint: './dist/index.js',
      capabilities: ['notify.run_state'],
    })
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist/index.js'), 'export {}\n')
    const registry = new ExtensionRegistry()

    const loaded = loadAllowlistedExtensionManifests({ paths: [dir], registry })

    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      manifest: {
        id: 'com.example.local-notifier',
        kind: 'notifier',
        source: 'operator-allowlisted',
        capabilities: ['notify.run_state'],
        entrypoint: './dist/index.js',
      },
      entrypointPath: join(dir, 'dist/index.js'),
    })
    expect(registry.get('notifier', 'com.example.local-notifier')).toBe(loaded[0])
  })

  it('requires explicit allowlisted paths and never discovers node_modules automatically', () => {
    const registry = new ExtensionRegistry()

    expect(loadAllowlistedExtensionManifests({ paths: [], registry })).toEqual([])
    expect(registry.list()).toEqual([])
  })

  it('rejects malformed or escaping allowlisted manifests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-ext-bad-'))
    cleanup.push(dir)

    writeManifest(dir, {
      schemaVersion: 'ductum.extension.v1',
      id: 'bad',
      kind: 'notifier',
      entrypoint: '../outside.js',
      capabilities: ['notify.run_state'],
    })

    expect(() => loadAllowlistedExtensionManifests({ paths: [dir] })).toThrow(
      /entrypoint must stay inside the extension directory/,
    )
  })
})

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, 'ductum-extension.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}
