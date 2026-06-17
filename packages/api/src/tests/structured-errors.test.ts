import { describe, expect, it } from 'vitest'

import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js'
import { renderStructuredErrorHuman, structuredError } from '../lib/errors-structured.js'

describe('structured error helper', () => {
  it('wraps existing API errors in the D135 error envelope', () => {
    const result = structuredError(
      new ValidationError('reason is required', { field: 'reason' }),
      { now: () => new Date('2026-05-03T12:00:00.000Z') },
    )
    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'error',
      data: {
        code: 'validation_error',
        message: 'reason is required',
        recoverable: true,
        suggestedActions: [],
        context: { status: 400, details: { field: 'reason' } },
      },
    })
  })

  it('keeps stable codes for common error classes', () => {
    expect(structuredError(new NotFoundError('missing')).data.code).toBe('not_found')
    expect(structuredError(new ConflictError('busy')).data.code).toBe('conflict')
  })

  it('renders suggested actions for human output', () => {
    const payload = structuredError(new ValidationError('bad input'), {
      suggestedActions: [{ kind: 'retry', description: 'Retry with a task id', cmd: 'ductum task list spec-1' }],
    }).data
    expect(renderStructuredErrorHuman(payload)).toContain('Suggested next steps:')
    expect(renderStructuredErrorHuman(payload)).toContain('ductum task list spec-1')
  })
})
