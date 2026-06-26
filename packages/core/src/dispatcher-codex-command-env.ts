import type { RunHarnessResourceSnapshot } from './agent-runtime-resolution.js'

export function applyCodexHarnessCommandEnv(
  harness: RunHarnessResourceSnapshot | null,
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (harness?.type !== 'codex-sdk' && harness?.type !== 'codex-app-server') return env
  if (env?.DUCTUM_CODEX_COMMAND != null && env.DUCTUM_CODEX_COMMAND.trim() !== '') return env
  if (harness.spec.command == null) return env
  return { ...(env ?? {}), DUCTUM_CODEX_COMMAND: harness.spec.command }
}
