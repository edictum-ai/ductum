import type { RunId } from '@ductum/core'

import { ClaudeHarnessAdapter } from './claude.js'
import { CodexAppServerHarnessAdapter } from './codex-app-server.js'
import { CodexSDKHarnessAdapter } from './codex-sdk.js'
import { CopilotSDKHarnessAdapter } from './copilot-sdk.js'
import { ExtensionRegistry, type ExtensionManifest, type ExtensionRegistration } from './extension-registry.js'
import { MockAgentCallHarnessAdapter } from './mock-agent-call-adapter.js'
import type { HarnessAdapter } from './types.js'

export interface BuiltInHarnessLoadOptions {
  apiUrl: string
  codexAppServerApproval?: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
  mockAgentCalls?: boolean
}

export interface BuiltInHarnessRegistration extends ExtensionRegistration {
  id: string
  manifest: ExtensionManifest & { kind: 'harness'; source: 'built-in' }
  loadMessage: string
  create(options: BuiltInHarnessLoadOptions): HarnessAdapter
}

const BUILT_IN_EXTENSION_REGISTRY = new ExtensionRegistry()

const BUILT_IN_HARNESSES = [
  {
    id: 'claude-agent-sdk',
    manifest: harnessManifest('claude-agent-sdk', ['spawn.local', 'mcp.in-process', 'usage.claude-jsonl']),
    loadMessage: 'Harness: claude-agent-sdk loaded',
    create: ({ apiUrl }) => new ClaudeHarnessAdapter(apiUrl),
  },
  {
    id: 'codex-app-server',
    manifest: harnessManifest('codex-app-server', ['spawn.local', 'mcp.http', 'approval.callback']),
    loadMessage: 'Harness: codex-app-server loaded (with Edictum enforcement)',
    create: ({ apiUrl, codexAppServerApproval }) => new CodexAppServerHarnessAdapter(apiUrl, {
      evaluateApproval: codexAppServerApproval,
    }),
  },
  {
    id: 'codex-sdk',
    manifest: harnessManifest('codex-sdk', ['spawn.local', 'mcp.http', 'compat.alias']),
    loadMessage: 'Harness: codex-sdk loaded (compat via codex-app-server enforcement)',
    create: ({ apiUrl, codexAppServerApproval }) => new CodexSDKHarnessAdapter(apiUrl, {
      evaluateApproval: codexAppServerApproval,
    }),
  },
  {
    id: 'copilot-sdk',
    manifest: harnessManifest('copilot-sdk', ['spawn.local', 'json-rpc', 'github-copilot']),
    loadMessage: 'Harness: copilot-sdk loaded (GitHub Copilot CLI via JSON-RPC)',
    create: ({ apiUrl }) => new CopilotSDKHarnessAdapter(apiUrl),
  },
] satisfies readonly BuiltInHarnessRegistration[]

for (const registration of BUILT_IN_HARNESSES) {
  BUILT_IN_EXTENSION_REGISTRY.register(registration)
}

export function listBuiltInHarnessRegistrations(): readonly BuiltInHarnessRegistration[] {
  return BUILT_IN_EXTENSION_REGISTRY.list<BuiltInHarnessRegistration>('harness')
}

export function loadBuiltInHarnessAdapters(options: BuiltInHarnessLoadOptions): {
  adapters: Map<string, HarnessAdapter>
  loaded: Array<Pick<BuiltInHarnessRegistration, 'id' | 'loadMessage'>>
} {
  if (options.mockAgentCalls === true) {
    return loadMockHarnessAdapters(options.apiUrl)
  }
  const adapters = new Map<string, HarnessAdapter>()
  const loaded: Array<Pick<BuiltInHarnessRegistration, 'id' | 'loadMessage'>> = []
  for (const registration of listBuiltInHarnessRegistrations()) {
    adapters.set(registration.id, registration.create(options))
    loaded.push({ id: registration.id, loadMessage: registration.loadMessage })
  }
  return { adapters, loaded }
}

function loadMockHarnessAdapters(apiUrl: string): {
  adapters: Map<string, HarnessAdapter>
  loaded: Array<Pick<BuiltInHarnessRegistration, 'id' | 'loadMessage'>>
} {
  const adapters = new Map<string, HarnessAdapter>()
  const loaded: Array<Pick<BuiltInHarnessRegistration, 'id' | 'loadMessage'>> = []
  for (const registration of listBuiltInHarnessRegistrations()) {
    adapters.set(registration.id, new MockAgentCallHarnessAdapter(apiUrl, registration.id))
    loaded.push({
      id: registration.id,
      loadMessage: `Harness: ${registration.id} loaded (mock agent calls)`,
    })
  }
  return { adapters, loaded }
}

function harnessManifest(id: string, capabilities: string[]): BuiltInHarnessRegistration['manifest'] {
  return { id, kind: 'harness', source: 'built-in', capabilities }
}
