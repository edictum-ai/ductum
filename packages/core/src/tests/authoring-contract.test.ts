import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildAuthoringContractFiles, MCP_AGENT_TOOL_CONTRACT } from '../index.js'

const root = resolve(import.meta.dirname, '../../../..')

describe('authoring contract generator', () => {
  it('matches the checked-in llms and tool examples files', () => {
    for (const file of buildAuthoringContractFiles()) {
      expect(readFileSync(resolve(root, file.path), 'utf8'), file.path).toBe(file.content)
    }
  })

  it('keeps the public MCP tool contract run-id free', () => {
    expect(MCP_AGENT_TOOL_CONTRACT).toHaveLength(12)
    for (const tool of MCP_AGENT_TOOL_CONTRACT) {
      expect(tool.input).not.toHaveProperty('run_id')
      expect(tool.example).not.toHaveProperty('run_id')
    }
  })
})
