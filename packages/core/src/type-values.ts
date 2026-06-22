export const MERGE_MODES = ['auto', 'human'] as const
export type MergeMode = typeof MERGE_MODES[number]

export const HARNESSES = ['claude-agent-sdk', 'vercel-ai', 'openai-agents', 'codex-app-server', 'codex-sdk', 'copilot-sdk'] as const
export type Harness = typeof HARNESSES[number]

export const AGENT_CAPABILITIES = ['build', 'test', 'fix', 'review', 'docs', 'quick-fix'] as const
export type AgentCapability = typeof AGENT_CAPABILITIES[number]

export const AGENT_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type AgentEffort = typeof AGENT_EFFORTS[number]

export const AGENT_ROLES = ['builder', 'reviewer', 'docs', 'watcher'] as const
export type AgentRole = typeof AGENT_ROLES[number]

export const TASK_COMPLEXITIES = ['simple', 'standard', 'complex'] as const
export type TaskComplexity = typeof TASK_COMPLEXITIES[number]
