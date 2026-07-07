import type { RunHarnessResourceSnapshot } from './agent-runtime-resolution.js'

export function applyCodexHarnessCommandEnv(
  harness: RunHarnessResourceSnapshot | null,
  env: Record<string, string> | undefined,
  fallbackEnv?: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  if (harness?.type !== 'codex-sdk' && harness?.type !== 'codex-app-server') return env
  if (env?.DUCTUM_CODEX_COMMAND != null && env.DUCTUM_CODEX_COMMAND.trim() !== '') return env
  if (harness.spec.command == null) return env
  return { ...(env ?? definedEnv(fallbackEnv)), DUCTUM_CODEX_COMMAND: harness.spec.command }
}

function definedEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}
