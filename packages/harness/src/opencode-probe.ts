export const DUCTUM_HEALTH_PROBE_TOOL = '__ductum_health_probe__'
export const DUCTUM_HEALTH_PROBE_AGENT = '__ductum_health_probe_agent__'

interface ProbeArgs {
  prompt?: unknown
  description?: unknown
  subagent_type?: unknown
}

export interface OpenCodeSubtaskPartInput {
  type: 'subtask'
  prompt: string
  description: string
  agent: string
}

export function buildHealthProbePart(targetSessionId: string): OpenCodeSubtaskPartInput {
  return {
    type: 'subtask',
    prompt: DUCTUM_HEALTH_PROBE_TOOL,
    description: targetSessionId,
    agent: DUCTUM_HEALTH_PROBE_AGENT,
  }
}

export function extractHealthProbeTarget(tool: string, args: unknown): string | null {
  if (tool !== 'task') {
    return null
  }

  const probeArgs = asProbeArgs(args)
  if (probeArgs?.prompt !== DUCTUM_HEALTH_PROBE_TOOL) {
    return null
  }
  if (probeArgs.subagent_type !== DUCTUM_HEALTH_PROBE_AGENT) {
    return null
  }
  if (typeof probeArgs.description !== 'string' || probeArgs.description.length === 0) {
    return null
  }

  return probeArgs.description
}

export function sanitizeOpenCodeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function buildDuctumMcpToolIds(serverName: string): string[] {
  const prefix = sanitizeOpenCodeName(serverName)
  return DUCTUM_MCP_TOOL_NAMES.map((toolName) => `${prefix}_${sanitizeOpenCodeName(toolName)}`)
}

const DUCTUM_MCP_TOOL_NAMES = [
  'ductum.next_task',
  'ductum.accept',
  'ductum.complete',
  'ductum.update',
  'ductum.heartbeat',
  'ductum.decide',
  'ductum.gate_check',
  'ductum.wait',
  'ductum.fail',
  'ductum.evidence',
  'ductum.link',
  'ductum.get_context',
] as const

function asProbeArgs(value: unknown): ProbeArgs | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as ProbeArgs
}
