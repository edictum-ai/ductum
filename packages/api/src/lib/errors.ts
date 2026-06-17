import { AgentRuntimeResolutionError, FactorySettingsValidationError, PrerequisiteCheckError } from '@ductum/core'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, message, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(404, message, details)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(403, message, details)
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, message, details)
    this.name = 'ConflictError'
  }
}

export class NotImplementedError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(501, message, details)
    this.name = 'NotImplementedError'
  }
}

function isConflictMessage(message: string): boolean {
  return (
    message.startsWith('Invalid transition:') ||
    message.startsWith('Parallel latches can only start') ||
    message.startsWith('Latch resolution requires') ||
    message.startsWith('Cannot mark ') ||
    message.startsWith('Only stalled runs can resume')
  )
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error
  }

  if (error instanceof SyntaxError) {
    return new ValidationError('Invalid JSON body')
  }

  const message = error instanceof Error ? error.message : 'Internal server error'

  if (error instanceof AgentRuntimeResolutionError) {
    return isOperatorInputRuntimeResolution(error)
      ? new ValidationError(message)
      : new HttpError(500, message)
  }
  if (error instanceof FactorySettingsValidationError) {
    return new ValidationError(message)
  }
  if (error instanceof PrerequisiteCheckError) {
    return new ConflictError(message, { items: error.issues })
  }
  if (/not found/i.test(message)) {
    return new NotFoundError(message)
  }
  if (isConflictMessage(message) || message.includes('UNIQUE constraint failed')) {
    return new ConflictError(message)
  }
  if (
    message.includes('FOREIGN KEY constraint failed') ||
    message.includes('CHECK constraint failed') ||
    message.includes('NOT NULL constraint failed')
  ) {
    return new ValidationError(message)
  }

  return new HttpError(500, message)
}

function isOperatorInputRuntimeResolution(error: AgentRuntimeResolutionError): boolean {
  return error.code === 'resource_not_found'
    || error.code === 'resource_wrong_kind'
    || error.code === 'resource_cross_project'
    || error.code === 'resource_ambiguous'
    || error.code === 'resource_malformed'
}
