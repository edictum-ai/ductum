import { AgentRuntimeResolutionError } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { toHttpError } from '../lib/errors.js'

describe('toHttpError', () => {
  it('maps runtime ref errors by code instead of message text', () => {
    const operatorInput = toHttpError(new AgentRuntimeResolutionError('renamed missing-ref message', 'resource_not_found'))
    const serverState = toHttpError(new AgentRuntimeResolutionError('renamed unsupported-adapter message', 'unsupported_harness'))

    expect(operatorInput.status).toBe(400)
    expect(serverState.status).toBe(500)
  })
})
