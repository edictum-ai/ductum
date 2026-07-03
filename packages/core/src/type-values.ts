export const MERGE_MODES = ['auto', 'human'] as const
export type MergeMode = typeof MERGE_MODES[number]

export const HARNESSES = ['claude-agent-sdk', 'vercel-ai', 'openai-agents', 'codex-app-server', 'codex-sdk', 'copilot-sdk'] as const
export type Harness = typeof HARNESSES[number]

export const AGENT_CAPABILITIES = ['build', 'test', 'fix', 'review', 'docs', 'quick-fix'] as const
export type AgentCapability = typeof AGENT_CAPABILITIES[number]

export const AGENT_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type AgentEffort = typeof AGENT_EFFORTS[number]

/**
 * Runtime guard for the `AgentEffort` enum. The catalog and API both
 * keep effort validation closed (no `none`, since `codex-app-server`
 * `model_reasoning_effort` does not accept it) — share one helper so
 * the two surfaces cannot drift apart when the enum widens.
 */
export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === 'string' && (AGENT_EFFORTS as readonly string[]).includes(value)
}

/**
 * Effort subsets each wired harness can actually send. These are the
 * single source of truth shared by the harness adapters
 * (`normalizeCodexEffort`, `normalizeClaudeEffort`) and the catalog
 * parity tests in `model-registry-efforts.test.ts` — keeping them in
 * core (where `AgentEffort` lives) means core never has to import from
 * `@ductum/harness`, and any change to one surface is reflected in the
 * other. `none` is intentionally absent from both: it is only valid for
 * Codex `plan_mode_reasoning_effort` (which Ductum does not configure
 * separately) and the Claude-compatible path has no `none` mapping.
 */
export const CODEX_SENDABLE_EFFORTS: readonly AgentEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh']
export const CLAUDE_SENDABLE_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const AGENT_ROLES = ['builder', 'reviewer', 'docs', 'watcher'] as const
export type AgentRole = typeof AGENT_ROLES[number]

export const TASK_COMPLEXITIES = ['simple', 'standard', 'complex'] as const
export type TaskComplexity = typeof TASK_COMPLEXITIES[number]
