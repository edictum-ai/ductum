import { z } from 'zod/v4'
import { getMcpAgentToolContract } from '@ductum/core'

import type { DuctumMcpServer } from '../server.js'
import { okResult, safeToolCall } from './shared.js'

const toolDescription = (name: string) => getMcpAgentToolContract(name).description

export function registerLifecycleTools(server: DuctumMcpServer) {
  server.mcp.registerTool(
    'ductum.next_task',
    {
      description: toolDescription('ductum.next_task'),
      inputSchema: z
        .object({
          project: z.string().min(1).optional(),
          role: z.string().min(1).optional(),
        })
        .strict()
        .default({}),
    },
    async ({ project, role }) =>
      safeToolCall(async () => {
        const task = await server.client.nextTask(project, role)
        if (task == null) {
          return okResult('No unblocked task is available.', { ok: true, available: false, task: null })
        }

        return okResult(`Next task is ${task.id}.`, { ok: true, available: true, task })
      }, server, 'ductum.next_task'),
  )

  server.mcp.registerTool(
    'ductum.accept',
    {
      description: toolDescription('ductum.accept'),
      inputSchema: z
        .object({
          task_id: z.string().min(1),
        })
        .strict(),
    },
    async ({ task_id }) =>
      safeToolCall(async () => {
        const accepted = await server.client.accept(task_id)
        server.bindToRun(accepted.run.id)

        return okResult(`Accepted task ${accepted.task.id} and bound run ${accepted.run.id}.`, {
          ok: true,
          boundRunId: accepted.run.id,
          prompt: accepted.task.prompt,
          run: accepted.run,
          task: accepted.task,
        })
      }, server, 'ductum.accept'),
  )

  server.mcp.registerTool(
    'ductum.complete',
    {
      description: toolDescription('ductum.complete'),
      inputSchema: z
        .object({
          result: z.string().min(50, 'completion summary must be at least 50 chars — describe what was changed'),
          pr: z.string().min(1).optional(),
        })
        .strict(),
    },
    async ({ result, pr }) =>
      safeToolCall(async () => {
        const runId = server.resolveRunId()
        const run = await server.client.complete(runId, result, pr)
        const message =
          run.stage === 'done'
            ? `Marked run ${run.id} as done.`
            : `Recorded completion for run ${run.id}. Factory-controlled verification/review/ship may still be pending.`

        return okResult(message, { ok: true, boundRunId: run.id, run })
      }, server, 'ductum.complete'),
  )

  return server
}
