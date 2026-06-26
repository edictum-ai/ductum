import type { EnrichedAttempt, EnrichedRun } from '@/api/client'
import { runDisplayStatus } from '@/lib/run-presentation'

type LineageRun = EnrichedRun | EnrichedAttempt

export function runActivityTime(run: LineageRun): number {
  return new Date(run.lastHeartbeat ?? run.updatedAt).getTime()
}

export function runLineageKey(run: LineageRun): string {
  return `${run.projectName}\u0000${run.specName}\u0000${run.taskName}`
}

export function latestRunByLineage(runs: readonly LineageRun[]): Map<string, LineageRun> {
  const latest = new Map<string, LineageRun>()
  for (const run of [...runs].sort((a, b) => runActivityTime(b) - runActivityTime(a))) {
    const key = runLineageKey(run)
    if (!latest.has(key)) latest.set(key, run)
  }
  return latest
}

export function isSupersededProblemRun(run: LineageRun, latest: LineageRun | undefined): boolean {
  if (latest == null || latest.id === run.id) return false
  const status = runDisplayStatus(run)
  if (status !== 'failed' && status !== 'stalled') return false
  return runActivityTime(latest) > runActivityTime(run)
}
