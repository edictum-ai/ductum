import { z } from 'zod/v4'

import type { DuctumMcpServer } from '../server.js'
import { errorResult, okResult, safeToolCall } from './shared.js'

export function registerRecoveryTools(server: DuctumMcpServer) {
  server.mcp.registerTool(
    'ductum.get_context',
    {
      description: 'Get crash recovery context for a task and bind this MCP session to its run.',
      inputSchema: z
        .object({
          task_id: z.string().min(1),
        })
        .strict(),
    },
    async ({ task_id }) =>
      safeToolCall(async () => {
        const context = await server.client.getContext(task_id)
        if (context.run == null) {
          return errorResult(`No existing run context found for task ${task_id}.`, {
            task: context.task,
            taskId: task_id,
          })
        }

        server.bindToRun(context.run.id)
        return okResult(`Loaded context for task ${task_id} and bound run ${context.run.id}.`, {
          ok: true,
          boundRunId: context.run.id,
          context,
        })
      }, server, 'ductum.get_context'),
  )

  return server
}
