import type { RunId } from '@ductum/core'

import { ClaudeHarnessAdapter } from './claude.js'
import { CodexAppServerHarnessAdapter } from './codex-app-server.js'
import { CodexSDKHarnessAdapter } from './codex-sdk.js'
import { CopilotSDKHarnessAdapter } from './copilot-sdk.js'
import { MockAgentCallHarnessAdapter } from './mock-agent-call-adapter.js'
import type { HarnessAdapter } from './types.js'

export interface BuiltInHarnessLoadOptions {
  apiUrl: string
  codexAppServerApproval?: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
  mockAgentCalls?: boolean
}

export interface BuiltInHarnessRegistration {
  id: string
  loadMessage: string
  create(options: BuiltInHarnessLoadOptions): HarnessAdapter
}

const BUILT_IN_HARNESSES: readonly BuiltInHarnessRegistration[] = [
  {
    id: 'claude-agent-sdk',
    loadMessage: 'Harness: claude-agent-sdk loaded',
    create: ({ apiUrl }) => new ClaudeHarnessAdapter(apiUrl),
  },
  {
    id: 'codex-app-server',
    loadMessage: 'Harness: codex-app-server loaded (with Edictum enforcement)',
    create: ({ apiUrl, codexAppServerApproval }) => new CodexAppServerHarnessAdapter(apiUrl, {
      evaluateApproval: codexAppServerApproval,
    }),
  },
  {
    id: 'codex-sdk',
    loadMessage: 'Harness: codex-sdk loaded (compat via codex-app-server enforcement)',
    create: ({ apiUrl, codexAppServerApproval }) => new CodexSDKHarnessAdapter(apiUrl, {
      evaluateApproval: codexAppServerApproval,
    }),
  },
  {
    id: 'copilot-sdk',
    loadMessage: 'Harness: copilot-sdk loaded (GitHub Copilot CLI via JSON-RPC)',
    create: ({ apiUrl }) => new CopilotSDKHarnessAdapter(apiUrl),
  },
] as const

export function listBuiltInHarnessRegistrations(): readonly BuiltInHarnessRegistration[] {
  return BUILT_IN_HARNESSES
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
  for (const registration of BUILT_IN_HARNESSES) {
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
  for (const registration of BUILT_IN_HARNESSES) {
    adapters.set(registration.id, new MockAgentCallHarnessAdapter(apiUrl, registration.id))
    loaded.push({
      id: registration.id,
      loadMessage: `Harness: ${registration.id} loaded (mock agent calls)`,
    })
  }
  return { adapters, loaded }
}
