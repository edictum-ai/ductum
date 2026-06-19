import { z } from 'zod/v4'
import { getMcpAgentToolContract } from '@ductum/core'

import type { DuctumMcpServer } from '../server.js'
import { okResult, safeToolCall } from './shared.js'

const toolDescription = (name: string) => getMcpAgentToolContract(name).description

export function registerProgressTools(server: DuctumMcpServer) {
  server.mcp.registerTool(
    'ductum.update',
    {
      description: toolDescription('ductum.update'),
      inputSchema: z
        .object({
          message: z.string().min(1),
        })
        .strict(),
    },
    async ({ message }) =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const update = await server.client.update(runId, message)
        return okResult(`Recorded progress update for run ${runId}.`, {
          ok: true,
          boundRunId: runId,
          update,
        })
      }, server, 'ductum.update'),
  )

  server.mcp.registerTool(
    'ductum.heartbeat',
    {
      description: toolDescription('ductum.heartbeat'),
      inputSchema: z.object({}).strict().default({}),
    },
    async () =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const run = await server.client.heartbeat(runId)
        return okResult(`Heartbeat recorded for run ${run.id}.`, { ok: true, boundRunId: run.id, run })
      }, server, 'ductum.heartbeat'),
  )

  server.mcp.registerTool(
    'ductum.decide',
    {
      description: toolDescription('ductum.decide'),
      inputSchema: z
        .object({
          decision: z.string().min(1),
          context: z.string().min(1),
          alternatives: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    },
    async ({ decision, context, alternatives }) =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const record = await server.client.decide(runId, decision, context, alternatives)
        return okResult(`Recorded decision ${record.id} for run ${runId}.`, {
          ok: true,
          boundRunId: runId,
          decision: record,
        })
      }, server, 'ductum.decide'),
  )

  return server
}
