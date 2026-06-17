import type { ApiContext } from '../deps.js'
import { requireTask } from './common.js'

export function getTaskContext(context: ApiContext, taskId: string) {
  const task = requireTask(context, taskId)
  const runs = context.repos.runs.list(task.id)
  const RESUMABLE_STAGES = new Set(['understand', 'implement'])
  const run =
    runs.find((r) => r.terminalState === 'stalled') ??
    runs.find((r) => r.terminalState == null && RESUMABLE_STAGES.has(r.stage)) ??
    runs.at(-1) ??
    null
  return {
    task,
    run,
    history: run == null ? [] : context.repos.runHistory.list(run.id),
    evidence: run == null ? [] : context.repos.evidence.list(run.id),
    gateEvaluations: run == null ? [] : context.repos.gateEvaluations.list(run.id),
    progressUpdates: run == null ? [] : context.repos.runUpdates.list(run.id),
    git:
      run == null
        ? null
        : {
            branch: run.branch,
            commitSha: run.commitSha,
            prNumber: run.prNumber,
            prUrl: run.prUrl,
          },
  }
}

export function recordPluginProbe(context: ApiContext, sessionId: string) {
  context.pluginProbes.set(sessionId, context.now().getTime())
}

export function getPluginProbeStatus(context: ApiContext, sessionId: string) {
  const lastSeen = context.pluginProbes.get(sessionId)
  if (lastSeen == null) return { seen: false }

  const mapping = context.repos.sessionRunMappings.get(sessionId)
  const intervalSeconds =
    (mapping == null ? null : context.repos.runs.get(mapping.runId)?.heartbeatTimeoutSeconds) ??
    context.repos.factory.get()?.config.heartbeatTimeoutSeconds ??
    120

  return {
    seen: context.now().getTime() - lastSeen <= intervalSeconds * 1000,
    lastSeenAt: new Date(lastSeen).toISOString(),
  }
}
