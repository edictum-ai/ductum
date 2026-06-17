import type { Hono } from 'hono'
import { redactPublicOutput, redactPublicText } from '@ductum/core'

import { toHttpError } from '../lib/errors.js'

export function registerErrorHandling(app: Hono) {
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((error, c) => {
    const httpError = toHttpError(error)
    const status = httpError.status as 400 | 403 | 404 | 409 | 500
    return c.json(
      httpError.details === undefined
        ? { error: redactPublicText(httpError.message) }
        : {
            error: redactPublicText(httpError.message),
            details: redactPublicOutput(httpError.details),
          },
      status,
    )
  })
}
