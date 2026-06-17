import { describe, expect, it, vi } from 'vitest'

import { guard, guardToolOutput, type GuardValidator } from '../tool-output-guards.js'

/**
 * Hand-rolled validator for a ductum.complete-shaped payload. Mirrors
 * the zod schema registered on the MCP tool — result is required and
 * must be at least 50 chars. Keeping this local (no zod dep) proves the
 * guard library is zod-agnostic.
 */
interface CompletePayload {
  result: string
  pr?: string
}

const completeValidator: GuardValidator<CompletePayload> = {
  safeParse(input) {
    if (typeof input !== 'object' || input == null) {
      return {
        success: false,
        error: {
          issues: [{ path: [], message: 'expected object' }],
        },
      }
    }
    const obj = input as Record<string, unknown>
    const issues: Array<{ path: Array<string | number>; message: string }> = []

    if (typeof obj.result !== 'string') {
      issues.push({ path: ['result'], message: 'result is required' })
    } else if (obj.result.length < 50) {
      issues.push({
        path: ['result'],
        message: `completion summary must be at least 50 chars — describe what was changed (got ${obj.result.length})`,
      })
    }

    if (obj.pr != null && typeof obj.pr !== 'string') {
      issues.push({ path: ['pr'], message: 'pr must be a string' })
    }

    if (issues.length > 0) {
      return { success: false, error: { issues } }
    }
    return {
      success: true,
      data: { result: obj.result as string, pr: obj.pr as string | undefined },
    }
  },
}

describe('guardToolOutput', () => {
  it('passes valid input through unchanged', () => {
    const result = guardToolOutput(
      { validator: completeValidator, name: 'ductum.complete' },
      { result: 'x'.repeat(60) },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.result.length).toBe(60)
    }
  })

  it('returns structured error on short summary with actionable message', () => {
    const result = guardToolOutput(
      { validator: completeValidator, name: 'ductum.complete' },
      { result: 'too short' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.issues).toHaveLength(1)
      expect(result.error.issues[0]!.path).toBe('result')
      expect(result.error.message).toContain('ductum.complete')
      expect(result.error.message).toContain('at least 50 chars')
    }
  })

  it('returns root-level error with <root> path when input is not an object', () => {
    const result = guardToolOutput(
      { validator: completeValidator, name: 'ductum.complete' },
      'not an object',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.issues[0]!.path).toBe('<root>')
    }
  })

  it('defaults the tool name to "tool output" when unset', () => {
    const result = guardToolOutput({ validator: completeValidator }, { result: 'short' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('tool output')
    }
  })

  it('aggregates multiple issues into one message', () => {
    const result = guardToolOutput(
      { validator: completeValidator, name: 'ductum.complete' },
      { result: 'too short', pr: 123 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.issues).toHaveLength(2)
      expect(result.error.message).toContain('result:')
      expect(result.error.message).toContain('pr:')
    }
  })
})

describe('guard (functional wrapper)', () => {
  it('invokes the inner function with parsed data on success', async () => {
    const inner = vi.fn(async (payload: CompletePayload) => ({ runId: 'r1', saved: payload.result }))
    const wrapped = guard(
      { validator: completeValidator, name: 'ductum.complete' },
      inner,
    )
    const result = await wrapped({ result: 'a long enough summary that satisfies the 50 char minimum rule' })
    expect(result.ok).toBe(true)
    expect(inner).toHaveBeenCalledTimes(1)
    if (result.ok) {
      expect(result.value.runId).toBe('r1')
    }
  })

  it('does NOT invoke the inner function on validation failure', async () => {
    const inner = vi.fn(async () => 'should not run')
    const wrapped = guard(
      { validator: completeValidator, name: 'ductum.complete' },
      inner,
    )
    const result = await wrapped({ result: 'short' })
    expect(result.ok).toBe(false)
    expect(inner).not.toHaveBeenCalled()
  })

  it('propagates errors thrown by the inner function', async () => {
    const wrapped = guard(
      { validator: completeValidator, name: 'ductum.complete' },
      async () => {
        throw new Error('inner boom')
      },
    )
    await expect(
      wrapped({ result: 'x'.repeat(60) }),
    ).rejects.toThrow('inner boom')
  })
})
