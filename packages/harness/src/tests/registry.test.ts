import { describe, expect, it } from 'vitest'

import { ExtensionRegistry } from '../extension-registry.js'
import { listBuiltInHarnessRegistrations, loadBuiltInHarnessAdapters } from '../registry.js'

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
})
