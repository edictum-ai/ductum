import type { RunId } from '@ductum/core'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { fileURLToPath } from 'node:url'

import { DuctumApiClient } from './api-client.js'
import { DuctumMcpServer } from './server.js'

export function createMcpServer(apiUrl: string, preBindRunId?: RunId): DuctumMcpServer {
  return new DuctumMcpServer(new DuctumApiClient(apiUrl), preBindRunId)
}

export function getMcpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): {
  apiUrl: string
  preBindRunId?: RunId
} {
  return {
    apiUrl: env.DUCTUM_API_URL ?? 'http://localhost:4100',
    preBindRunId: env.DUCTUM_RUN_ID as RunId | undefined,
  }
}

export async function startStdioServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { apiUrl, preBindRunId } = getMcpConfigFromEnv(env)
  const server = createMcpServer(apiUrl, preBindRunId)
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
