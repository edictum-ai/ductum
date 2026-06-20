export interface McpAgentToolContract {
  name: string
  description: string
  input: Record<string, string>
  required: string[]
  example: Record<string, unknown>
}

export const MCP_AGENT_TOOL_CONTRACT = [
  tool('ductum.workflow', 'Get the workflow rules for this run. Call this FIRST to understand allowed tools, stage exit conditions, and current stage.', {}, {}),
  tool('ductum.gate_check', 'Query the current workflow state for the bound run. Read-only; stage advancement is automatic.', {}, {}),
  tool('ductum.next_task', 'Get the next unblocked task for an optional project and role.', { project: 'optional project name', role: 'optional role name' }, {}),
  tool('ductum.accept', 'Claim a task, create a run, and bind this MCP session to it.', { task_id: 'task id to claim' }, { task_id: 'task_123' }, ['task_id']),
  tool('ductum.get_context', 'Get context for a task. If this MCP session is unbound, bind it to the recovered run; otherwise preserve the current bound run.', { task_id: 'task id to inspect or recover' }, { task_id: 'task_123' }, ['task_id']),
  tool('ductum.update', 'Record a progress update for the bound run.', { message: 'short progress note' }, { message: 'Implemented parser changes; running tests next.' }, ['message']),
  tool('ductum.heartbeat', 'Refresh the heartbeat for the bound run.', {}, {}),
  tool('ductum.decide', 'Record a decision on the bound run.', { decision: 'chosen path', context: 'why this was decided', alternatives: 'optional array of rejected alternatives' }, { decision: 'Keep the parser strict', context: 'Loose parsing would hide invalid specs.' }, ['decision', 'context']),
  tool('ductum.evidence', 'Attach evidence to the bound run.', { type: 'evidence type', payload: 'JSON object payload' }, { type: 'test', payload: { command: 'pnpm test', passed: true } }, ['type', 'payload']),
  tool('ductum.link', 'Link branch, commit, or PR metadata to the bound run.', { branch: 'optional branch', commit: 'optional commit sha', pr: 'optional PR URL or number' }, { branch: 'feat/example', commit: 'abc1234' }),
  tool('ductum.complete', 'Mark the bound implementation session complete. The factory may still verify, review, and ship it.', { result: 'completion summary, at least 50 characters', pr: 'optional PR URL or number' }, { result: 'Implemented the parser fix, added regression coverage, and ran the requested test suite.' }, ['result']),
  tool('ductum.fail', 'Report a recoverable or terminal failure on the bound run.', { reason: 'failure reason', recoverable: 'optional boolean, defaults to recoverable handling' }, { reason: 'Cannot continue because required credentials are missing.', recoverable: false }, ['reason']),
] as const satisfies readonly McpAgentToolContract[]

export function getMcpAgentToolContract(name: string): McpAgentToolContract {
  const contract = MCP_AGENT_TOOL_CONTRACT.find((toolContract) => toolContract.name === name)
  if (contract == null) throw new Error(`Unknown MCP agent tool contract: ${name}`)
  return contract
}

function tool(
  name: string,
  description: string,
  input: Record<string, string>,
  example: Record<string, unknown>,
  required: string[] = [],
): McpAgentToolContract {
  return { name, description, input, required, example }
}
