import type { EnrichedRun } from '@/api/client'
import { runDisplayStatus } from '@/lib/run-presentation'

export function runActivityTime(run: EnrichedRun): number {
  return new Date(run.lastHeartbeat ?? run.updatedAt).getTime()
}

export function runLineageKey(run: EnrichedRun): string {
  return `${run.projectName}\u0000${run.specName}\u0000${run.taskName}`
}

export function latestRunByLineage(runs: readonly EnrichedRun[]): Map<string, EnrichedRun> {
  const latest = new Map<string, EnrichedRun>()
  for (const run of [...runs].sort((a, b) => runActivityTime(b) - runActivityTime(a))) {
    const key = runLineageKey(run)
    if (!latest.has(key)) latest.set(key, run)
  }
  return latest
}

export function isSupersededProblemRun(run: EnrichedRun, latest: EnrichedRun | undefined): boolean {
  if (latest == null || latest.id === run.id) return false
  const status = runDisplayStatus(run)
  if (status !== 'failed' && status !== 'stalled') return false
  return runActivityTime(latest) > runActivityTime(run)
}
