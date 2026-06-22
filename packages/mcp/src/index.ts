import type { RunId } from '@ductum/core'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { fileURLToPath } from 'node:url'

import { DuctumApiClient } from './api-client.js'
import { DuctumMcpServer } from './server.js'

export function createMcpServer(
  apiUrl: string,
  preBindRunId?: RunId,
  options: { controlToken?: string | null } = {},
): DuctumMcpServer {
  return new DuctumMcpServer(new DuctumApiClient(apiUrl, { controlToken: options.controlToken }), preBindRunId)
}

export function getMcpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): {
  apiUrl: string
  preBindRunId?: RunId
  controlToken?: string
} {
  return {
    apiUrl: env.DUCTUM_API_URL ?? 'http://localhost:4100',
    preBindRunId: env.DUCTUM_RUN_ID as RunId | undefined,
    controlToken: env.DUCTUM_CONTROL_TOKEN,
  }
}

export async function startStdioServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { apiUrl, preBindRunId, controlToken } = getMcpConfigFromEnv(env)
  const server = createMcpServer(apiUrl, preBindRunId, { controlToken })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (entry == null) {
    return false
  }

  return fileURLToPath(import.meta.url) === entry
}

if (isMainModule()) {
  startStdioServer().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}

export * from './api-client.js'
export * from './server.js'
export * from './types.js'
