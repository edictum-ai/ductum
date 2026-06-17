import { z } from 'zod/v4'

import type { DuctumMcpServer } from '../server.js'
import { okResult, safeToolCall } from './shared.js'

export function registerEvidenceTools(server: DuctumMcpServer) {
  server.mcp.registerTool(
    'ductum.evidence',
    {
      description: 'Attach evidence to the bound run.',
      inputSchema: z
        .object({
          type: z.string().min(1),
          payload: z.record(z.string(), z.unknown()),
        })
        .strict(),
    },
    async ({ type, payload }) =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const evidence = await server.client.evidence(runId, type, payload)
        return okResult(`Attached evidence ${evidence.id} to run ${runId}.`, {
          ok: true,
          boundRunId: runId,
          evidence,
        })
      }, server, 'ductum.evidence'),
  )

  server.mcp.registerTool(
    'ductum.link',
    {
      description: 'Link branch, commit, or PR metadata to the bound run.',
      inputSchema: z
        .object({
          branch: z.string().min(1).optional(),
          commit: z.string().min(1).optional(),
          pr: z.string().min(1).optional(),
        })
        .strict()
        .default({}),
    },
    async ({ branch, commit, pr }) =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const run = await server.client.link(runId, { branch, commit, pr })
        return okResult(`Linked git artifacts for run ${run.id}.`, {
          ok: true,
          boundRunId: run.id,
          run,
        })
      }, server, 'ductum.link'),
  )

  return server
}
