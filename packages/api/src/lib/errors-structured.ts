import { redactPublicOutput, redactPublicText } from '@ductum/core'

import { envelope, type SchemaEnvelope } from './envelope.js'
import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError, toHttpError } from './errors.js'

export interface SuggestedAction {
  kind: string
  description: string
  cmd?: string
  args?: Record<string, unknown>
}

export interface StructuredErrorData {
  code: string
  message: string
  recoverable: boolean
  suggestedActions: SuggestedAction[]
  context: Record<string, unknown>
}

export type StructuredErrorEnvelope = SchemaEnvelope<'error', StructuredErrorData>

export function structuredError(
  error: unknown,
  options: {
    code?: string
    recoverable?: boolean
    suggestedActions?: SuggestedAction[]
    context?: Record<string, unknown>
    now?: () => Date
  } = {},
): StructuredErrorEnvelope {
  const httpError = toHttpError(error)
  return envelope('error', {
    code: options.code ?? errorCode(httpError),
    message: redactPublicText(httpError.message),
    recoverable: options.recoverable ?? isRecoverable(httpError),
    suggestedActions: redactPublicOutput(options.suggestedActions ?? []),
    context: {
      status: httpError.status,
      ...(httpError.details === undefined ? {} : { details: redactPublicOutput(httpError.details) }),
      ...redactPublicOutput(options.context ?? {}),
    },
  }, options.now)
}

export function renderStructuredErrorHuman(error: StructuredErrorData): string {
  const lines = [redactPublicText(error.message)]
  if (error.suggestedActions.length > 0) {
    lines.push('', 'Suggested next steps:')
    for (const action of error.suggestedActions) {
      lines.push(`- ${redactPublicText(action.description)}`)
      if (action.cmd != null) lines.push(`  ${redactPublicText(action.cmd)}`)
    }
  }
  return lines.join('\n')
}

function errorCode(error: HttpError): string {
  if (error instanceof ValidationError) return 'validation_error'
  if (error instanceof NotFoundError) return 'not_found'
  if (error instanceof ForbiddenError) return 'forbidden'
  if (error instanceof ConflictError) return 'conflict'
  return error.status >= 500 ? 'internal_error' : 'http_error'
}

function isRecoverable(error: HttpError): boolean {
  return error.status === 400 || error.status === 409 || error.status >= 500
}
