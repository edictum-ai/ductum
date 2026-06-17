import { describe, expect, it } from 'vitest'

import {
  buildAuthRefreshError,
  buildUnsupportedMethodError,
  extractElicitationContext,
  isKnownNonInteractiveMethod,
  shapeApprovalDenied,
  shapeElicitationAccept,
  shapeElicitationDecline,
  shapePermissionsDecline,
  shapeToolCallBlock,
  shapeUserInputDecline,
} from '../codex-server-responses.js'

// ---------------------------------------------------------------------------
// Response shape tests
// ---------------------------------------------------------------------------

describe('shapeElicitationDecline', () => {
  it('returns a protocol-valid decline response', () => {
    expect(shapeElicitationDecline()).toEqual({
      action: 'decline',
      content: null,
      _meta: null,
    })
  })

  it('is JSON-serializable without loss', () => {
    const r = shapeElicitationDecline()
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
})

describe('shapeElicitationAccept', () => {
  it('returns a protocol-valid accept response', () => {
    expect(shapeElicitationAccept()).toEqual({
      action: 'accept',
      content: null,
      _meta: null,
    })
  })
})

describe('shapeUserInputDecline', () => {
  it('returns a protocol-valid empty answers response', () => {
    expect(shapeUserInputDecline()).toEqual({ answers: {} })
  })

  it('answers is a plain object (not null)', () => {
    expect(typeof shapeUserInputDecline().answers).toBe('object')
  })
})

describe('shapePermissionsDecline', () => {
  it('returns permissions + scope with no extra keys', () => {
    const r = shapePermissionsDecline()
    expect(Object.keys(r).sort()).toEqual(['permissions', 'scope'])
    expect(r.permissions).toEqual({})
    expect(r.scope).toBe('turn')
  })

  it('does not include strictAutoReview', () => {
    expect(shapePermissionsDecline()).not.toHaveProperty('strictAutoReview')
  })
})

describe('shapeApprovalDenied', () => {
  it('returns { decision: "denied" } with no extra keys', () => {
    expect(shapeApprovalDenied()).toEqual({ decision: 'denied' })
  })
})

describe('shapeToolCallBlock', () => {
  it('returns success=false with non-empty contentItems', () => {
    const r = shapeToolCallBlock()
    expect(r.success).toBe(false)
    expect(r.contentItems.length).toBeGreaterThan(0)
    for (const item of r.contentItems) {
      expect(item.type).toBe('inputText')
      expect(item.text.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Error builder tests
// ---------------------------------------------------------------------------

describe('buildAuthRefreshError', () => {
  it('returns a JSON-RPC server error with code and message', () => {
    const e = buildAuthRefreshError()
    expect(e.code).toBe(-32000)
    expect(e.message).toContain('auth token refresh')
    expect(e.message).toContain('codex login')
  })
})

describe('buildUnsupportedMethodError', () => {
  it('returns a JSON-RPC error with method-not-found code and method name', () => {
    const e = buildUnsupportedMethodError('some/future/method')
    expect(e.code).toBe(-32601)
    expect(e.message).toContain('some/future/method')
  })
})

// ---------------------------------------------------------------------------
// Method classification
// ---------------------------------------------------------------------------

describe('isKnownNonInteractiveMethod', () => {
  it('matches all known non-interactive methods', () => {
    expect(isKnownNonInteractiveMethod('mcpServer/elicitation/request')).toBe(true)
    expect(isKnownNonInteractiveMethod('item/tool/requestUserInput')).toBe(true)
    expect(isKnownNonInteractiveMethod('item/permissions/requestApproval')).toBe(true)
    expect(isKnownNonInteractiveMethod('item/tool/call')).toBe(true)
    expect(isKnownNonInteractiveMethod('applyPatchApproval')).toBe(true)
    expect(isKnownNonInteractiveMethod('execCommandApproval')).toBe(true)
    expect(isKnownNonInteractiveMethod('account/chatgptAuthTokens/refresh')).toBe(true)
  })

  it('does not match interactive approval methods', () => {
    expect(isKnownNonInteractiveMethod('item/commandExecution/requestApproval')).toBe(false)
    expect(isKnownNonInteractiveMethod('item/fileChange/requestApproval')).toBe(false)
  })

  it('does not match unknown methods', () => {
    expect(isKnownNonInteractiveMethod('some/unknown/method')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Elicitation context extraction
// ---------------------------------------------------------------------------

describe('extractElicitationContext', () => {
  it('extracts server name and message from valid params', () => {
    expect(extractElicitationContext({
      serverName: 'ductum_run_abc123',
      message: 'Do you want to proceed?',
    })).toEqual({ serverName: 'ductum_run_abc123', message: 'Do you want to proceed?' })
  })

  it('returns nulls for null/undefined/non-object params', () => {
    const empty = { serverName: null, message: null }
    expect(extractElicitationContext(null)).toEqual(empty)
    expect(extractElicitationContext(undefined)).toEqual(empty)
    expect(extractElicitationContext('string')).toEqual(empty)
    expect(extractElicitationContext(42)).toEqual(empty)
    expect(extractElicitationContext(true)).toEqual(empty)
    expect(extractElicitationContext([])).toEqual(empty)
  })

  it('returns nulls for wrong field types or missing fields', () => {
    expect(extractElicitationContext({ serverName: 123, message: {} }))
      .toEqual({ serverName: null, message: null })
    expect(extractElicitationContext({})).toEqual({ serverName: null, message: null })
  })

  it('handles partial fields', () => {
    expect(extractElicitationContext({ serverName: 'test' }))
      .toEqual({ serverName: 'test', message: null })
    expect(extractElicitationContext({ message: 'hello' }))
      .toEqual({ serverName: null, message: 'hello' })
  })
})
