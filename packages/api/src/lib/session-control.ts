import { timingSafeEqual } from 'node:crypto'

import type { ApiContext } from './deps.js'
import { ForbiddenError, NotFoundError } from './errors.js'

export const SESSION_CONTROL_TOKEN_HEADER = 'x-ductum-control-token'

export function requireSessionControl(
  context: ApiContext,
  sessionId: string,
  controlToken: string,
) {
  const mapping = context.repos.sessionRunMappings.get(sessionId)
  if (mapping == null) {
    throw new NotFoundError(`Session mapping not found: ${sessionId}`)
  }
  if (!tokensMatch(mapping.controlToken, controlToken)) {
    throw new ForbiddenError('Invalid session control token')
  }
  return mapping
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  if (expectedBytes.length !== actualBytes.length) {
    return false
  }
  return timingSafeEqual(expectedBytes, actualBytes)
}
