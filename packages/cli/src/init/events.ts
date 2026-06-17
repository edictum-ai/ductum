import { redactPublicOutput } from '@ductum/core'

import { createEnvelope } from '../output.js'
import type { CliContext } from '../runtime.js'
import { D135_INIT_STREAM_EVENT_KINDS } from '../event-registry.js'

export const INIT_EVENT_KINDS = D135_INIT_STREAM_EVENT_KINDS

export type InitEventKind = typeof INIT_EVENT_KINDS[number]

export function writeInitEvent(
  ctx: CliContext,
  kind: InitEventKind,
  data: Record<string, unknown>,
): void {
  if (ctx.outputMode === 'human') return
  ctx.stdout.write(`${JSON.stringify(redactPublicOutput(createEnvelope(kind, data, ctx.now)))}\n`)
}

export function writeInitCancelled(ctx: CliContext, reason = 'sigint'): void {
  ctx.stdout.write(`${JSON.stringify(redactPublicOutput(createEnvelope('init.cancelled', { reason }, ctx.now)))}\n`)
}
