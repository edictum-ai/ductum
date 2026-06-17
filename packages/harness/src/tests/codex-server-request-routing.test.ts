import { describe, expect, it } from 'vitest'

import { routeNonInteractiveRequest } from '../codex-server-request-routing.js'

type BlockedEvent = Extract<
  import('../types.js').HarnessEvent,
  { type: 'tool.blocked' }
>
type RequestedEvent = Extract<
  import('../types.js').HarnessEvent,
  { type: 'tool.requested' }
>

/** All non-interactive methods that the routing function handles explicitly. */
const KNOWN_METHODS = [
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
  'item/tool/requestUserInput',
  'account/chatgptAuthTokens/refresh',
  'applyPatchApproval',
  'execCommandApproval',
  'item/tool/call',
] as const

/** Get the single tool.blocked event from a routed result. */
function blockedEvent(routed: ReturnType<typeof routeNonInteractiveRequest>): BlockedEvent {
  expect(routed.events).toHaveLength(1)
  const ev = routed.events[0]
  expect(ev!.type).toBe('tool.blocked')
  return ev as BlockedEvent
}

function requestedEvent(routed: ReturnType<typeof routeNonInteractiveRequest>): RequestedEvent {
  expect(routed.events).toHaveLength(1)
  const ev = routed.events[0]
  expect(ev!.type).toBe('tool.requested')
  return ev as RequestedEvent
}

describe('routeNonInteractiveRequest', () => {
  // -----------------------------------------------------------------------
  // Every known method returns a well-formed ServerRequestResult
  // -----------------------------------------------------------------------

  it('returns a result for all known non-error methods', () => {
    const nonErrorMethods = KNOWN_METHODS.filter(
      (m) => m !== 'account/chatgptAuthTokens/refresh',
    )
    for (const method of nonErrorMethods) {
      const routed = routeNonInteractiveRequest(method, {})
      expect(routed.isError, `${method} should not be an error`).toBe(false)
      expect(routed.result, `${method} should have a result`).toBeDefined()
      expect(routed.error, `${method} should not have an error`).toBeUndefined()
    }
  })

  it('returns an error for auth refresh', () => {
    const routed = routeNonInteractiveRequest('account/chatgptAuthTokens/refresh', {})
    expect(routed.isError).toBe(true)
    expect(routed.error).toBeDefined()
    expect(routed.error!.code).toBe(-32000)
    expect(routed.error!.message).toContain('auth token refresh')
  })

  it('returns an error for unknown methods', () => {
    const routed = routeNonInteractiveRequest('some/unknown/method', {})
    expect(routed.isError).toBe(true)
    expect(routed.error).toBeDefined()
    expect(routed.error!.code).toBe(-32601)
    expect(routed.error!.message).toContain('some/unknown/method')
  })

  // -----------------------------------------------------------------------
  // Every known method emits exactly one tool.blocked event
  // -----------------------------------------------------------------------

  it('emits one tool.blocked event per known method', () => {
    for (const method of KNOWN_METHODS) {
      const routed = routeNonInteractiveRequest(method, {})
      expect(routed.events, `${method} should emit exactly one event`).toHaveLength(1)
      expect(routed.events[0]!.type, `${method} event type`).toBe('tool.blocked')
    }
  })

  it('does not emit events for unknown methods', () => {
    const routed = routeNonInteractiveRequest('unknown/method', {})
    expect(routed.events).toHaveLength(0)
  })

  // -----------------------------------------------------------------------
  // tool.blocked events include a non-empty reason
  // -----------------------------------------------------------------------

  it('every tool.blocked event has a non-empty reason string', () => {
    for (const method of KNOWN_METHODS) {
      const routed = routeNonInteractiveRequest(method, {})
      const ev = blockedEvent(routed)
      expect(typeof ev.reason, `${method} reason type`).toBe('string')
      expect(ev.reason!.length, `${method} reason non-empty`).toBeGreaterThan(0)
    }
  })

  // -----------------------------------------------------------------------
  // Permissions escalation
  // -----------------------------------------------------------------------

  describe('item/permissions/requestApproval', () => {
    it('returns { permissions: {}, scope: "turn" }', () => {
      const routed = routeNonInteractiveRequest('item/permissions/requestApproval', { network: true })
      expect(routed.result).toEqual({ permissions: {}, scope: 'turn' })
    })

    it('event toolName is PermissionsRequestApproval', () => {
      const routed = routeNonInteractiveRequest('item/permissions/requestApproval', {})
      expect(blockedEvent(routed).toolName).toBe('PermissionsRequestApproval')
    })

    it('passes params through in args', () => {
      const routed = routeNonInteractiveRequest('item/permissions/requestApproval', { extra: 'data' })
      expect(blockedEvent(routed).args).toEqual({ extra: 'data' })
    })
  })

  // -----------------------------------------------------------------------
  // MCP elicitation
  // -----------------------------------------------------------------------

  describe('mcpServer/elicitation/request', () => {
    it('returns a decline response', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {})
      expect(routed.result).toEqual({ action: 'decline', content: null, _meta: null })
    })

    it('accepts trusted Ductum MCP server elicitations', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {
        serverName: 'ductum_run_abc',
        message: 'Allow tool "ductum.workflow"?',
      }, { trustedMcpServerNames: ['ductum_run_abc'] })
      expect(routed.result).toEqual({ action: 'accept', content: null, _meta: null })
      expect(requestedEvent(routed).args).toHaveProperty('serverName', 'ductum_run_abc')
    })

    it('event includes serverName and message in args', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {
        serverName: 'ductum_run_abc',
        message: 'Proceed?',
      })
      const ev = blockedEvent(routed)
      expect(ev.args).toHaveProperty('serverName', 'ductum_run_abc')
      expect(ev.args).toHaveProperty('message', 'Proceed?')
    })

    it('event content is a readable server: message format', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {
        serverName: 'ductum_run_abc',
        message: 'Proceed?',
      })
      expect(blockedEvent(routed).content).toBe('ductum_run_abc: Proceed?')
    })

    it('handles missing serverName gracefully', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {
        message: 'Proceed?',
      })
      const ev = blockedEvent(routed)
      expect(ev.args).not.toHaveProperty('serverName')
      expect(ev.content).toBe('Proceed?')
    })

    it('handles missing message gracefully', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {
        serverName: 'srv',
      })
      const ev = blockedEvent(routed)
      expect(ev.args).not.toHaveProperty('message')
      expect(ev.content).toBe('srv')
    })

    it('event toolName is McpElicitation', () => {
      const routed = routeNonInteractiveRequest('mcpServer/elicitation/request', {})
      expect(blockedEvent(routed).toolName).toBe('McpElicitation')
    })
  })

  // -----------------------------------------------------------------------
  // User input
  // -----------------------------------------------------------------------

  describe('item/tool/requestUserInput', () => {
    it('returns { answers: {} }', () => {
      const routed = routeNonInteractiveRequest('item/tool/requestUserInput', {})
      expect(routed.result).toEqual({ answers: {} })
    })

    it('event toolName is ToolRequestUserInput', () => {
      const routed = routeNonInteractiveRequest('item/tool/requestUserInput', {})
      expect(blockedEvent(routed).toolName).toBe('ToolRequestUserInput')
    })
  })

  // -----------------------------------------------------------------------
  // Auth refresh
  // -----------------------------------------------------------------------

  describe('account/chatgptAuthTokens/refresh', () => {
    it('returns a JSON-RPC error (not a result)', () => {
      const routed = routeNonInteractiveRequest('account/chatgptAuthTokens/refresh', {})
      expect(routed.isError).toBe(true)
      expect(routed.error!.code).toBe(-32000)
    })

    it('event toolName is ChatgptAuthTokensRefresh', () => {
      const routed = routeNonInteractiveRequest('account/chatgptAuthTokens/refresh', {})
      expect(blockedEvent(routed).toolName).toBe('ChatgptAuthTokensRefresh')
    })

    it('event reason matches the error message', () => {
      const routed = routeNonInteractiveRequest('account/chatgptAuthTokens/refresh', {})
      expect(blockedEvent(routed).reason).toBe(routed.error!.message)
    })
  })

  // -----------------------------------------------------------------------
  // Apply-patch approval
  // -----------------------------------------------------------------------

  describe('applyPatchApproval', () => {
    it('returns { decision: "denied" }', () => {
      const routed = routeNonInteractiveRequest('applyPatchApproval', {})
      expect(routed.result).toEqual({ decision: 'denied' })
    })

    it('event toolName is ApplyPatchApproval', () => {
      const routed = routeNonInteractiveRequest('applyPatchApproval', {})
      expect(blockedEvent(routed).toolName).toBe('ApplyPatchApproval')
    })
  })

  // -----------------------------------------------------------------------
  // Exec-command approval
  // -----------------------------------------------------------------------

  describe('execCommandApproval', () => {
    it('returns { decision: "denied" }', () => {
      const routed = routeNonInteractiveRequest('execCommandApproval', {})
      expect(routed.result).toEqual({ decision: 'denied' })
    })

    it('event toolName is ExecCommandApproval', () => {
      const routed = routeNonInteractiveRequest('execCommandApproval', {})
      expect(blockedEvent(routed).toolName).toBe('ExecCommandApproval')
    })
  })

  // -----------------------------------------------------------------------
  // Dynamic tool call
  // -----------------------------------------------------------------------

  describe('item/tool/call', () => {
    it('returns success=false with contentItems', () => {
      const routed = routeNonInteractiveRequest('item/tool/call', { tool: 'myTool' })
      const result = routed.result as { success: boolean; contentItems: unknown[] }
      expect(result.success).toBe(false)
      expect(result.contentItems.length).toBeGreaterThan(0)
    })

    it('event toolName includes the dynamic tool name', () => {
      const routed = routeNonInteractiveRequest('item/tool/call', { tool: 'myTool' })
      expect(blockedEvent(routed).toolName).toBe('DynamicToolCall/myTool')
    })

    it('falls back to "unknown" when tool param is missing', () => {
      const routed = routeNonInteractiveRequest('item/tool/call', {})
      expect(blockedEvent(routed).toolName).toBe('DynamicToolCall/unknown')
    })
  })

  // -----------------------------------------------------------------------
  // Unknown methods get explicit JSON-RPC error (not {})
  // -----------------------------------------------------------------------

  describe('unknown methods', () => {
    it('returns a method-not-found error, not an empty object', () => {
      const routed = routeNonInteractiveRequest('future/someMethod', {})
      expect(routed.isError).toBe(true)
      expect(routed.error).not.toEqual({})
      expect(routed.error!.code).toBe(-32601)
      expect(routed.error!.message).toContain('future/someMethod')
    })

    it('does not emit events for unknown methods', () => {
      const routed = routeNonInteractiveRequest('future/someMethod', {})
      expect(routed.events).toHaveLength(0)
    })
  })
})
