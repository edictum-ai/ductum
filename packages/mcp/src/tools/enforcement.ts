import { z } from 'zod/v4'
import { getMcpAgentToolContract } from '@ductum/core'

import type { DuctumMcpServer } from '../server.js'
import { okResult, safeToolCall } from './shared.js'

const toolDescription = (name: string) => getMcpAgentToolContract(name).description

export function registerEnforcementTools(server: DuctumMcpServer) {
  server.mcp.registerTool(
    'ductum.workflow',
    {
      description: toolDescription('ductum.workflow'),
      inputSchema: z.object({}).strict(),
    },
    async () =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const info = await server.client.getWorkflowInfo(runId)
        return okResult('Workflow rules and current state.', {
          ok: true,
          boundRunId: runId,
          ...info,
        })
      }, server, 'ductum.workflow'),
  )

  server.mcp.registerTool(
    'ductum.gate_check',
    {
      description: toolDescription('ductum.gate_check'),
      inputSchema: z.object({}).strict(),
    },
    async () =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const result = await server.client.gateCheck(runId)
        const message = result.blockedReason == null
          ? `Workflow state for run ${runId}.`
          : `Workflow state for run ${runId}. ${result.blockedReason}`
        return okResult(message, {
          ok: true,
          boundRunId: runId,
          stage: result.stage,
          completedStages: result.completedStages,
          pendingApproval: result.pendingApproval,
          blockedReason: result.blockedReason ?? null,
        })
      }, server, 'ductum.gate_check'),
  )

  server.mcp.registerTool(
    'ductum.fail',
    {
      description: toolDescription('ductum.fail'),
      inputSchema: z
        .object({
          reason: z.string().min(1),
          recoverable: z.boolean().optional(),
        })
        .strict(),
    },
    async ({ reason, recoverable }) =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const run = await server.client.fail(runId, reason, recoverable)
        if (run.terminalState === 'failed') {
          return okResult(`Marked run ${run.id} as failed.`, {
            ok: true,
            boundRunId: run.id,
            recoverable: false,
            run,
          })
        }

        return okResult(`Recoverable failure recorded; run ${run.id} reset to ${run.stage}.`, {
          ok: true,
          boundRunId: run.id,
          recoverable: true,
          run,
        })
      }, server, 'ductum.fail'),
  )

  return server
}
