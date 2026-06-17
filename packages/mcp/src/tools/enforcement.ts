import { z } from 'zod/v4'

import type { DuctumMcpServer } from '../server.js'
import { okResult, safeToolCall } from './shared.js'

export function registerEnforcementTools(server: DuctumMcpServer) {
  server.mcp.registerTool(
    'ductum.workflow',
    {
      description: 'Get the workflow rules for this run. Call this FIRST to understand what tools are allowed at each stage, what actions advance the workflow, and what the current stage is. Each stage has allowed tools and exit conditions — meet the exit conditions to automatically advance.',
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
      description: 'Query the current workflow state for the bound run. Read-only — stage advancement is automatic.',
      inputSchema: z.object({}).strict(),
    },
    async () =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const result = await server.client.gateCheck(runId)
        return okResult(`Workflow state for run ${runId}.`, {
          ok: true,
          boundRunId: runId,
          stage: result.stage,
          completedStages: result.completedStages,
          pendingApproval: result.pendingApproval,
        })
      }, server, 'ductum.gate_check'),
  )

  server.mcp.registerTool(
    'ductum.fail',
    {
      description: 'Report a recoverable or terminal failure on the bound run.',
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
