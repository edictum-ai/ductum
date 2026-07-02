import { api, type RunActivity } from '@/api/client'
import type { RunType } from './types'
import { sanitizeActivityRaw } from './activity-raw'

export function enc(segment: string): string {
  return encodeURIComponent(segment)
}

export function downloadTranscript(run: RunType, activity: RunActivity[]) {
  const header = [
    `Attempt: ${run.id}`,
    `Stage: ${run.stage}`,
    `Terminal: ${run.terminalState ?? 'live'}`,
    `Branch: ${run.branch ?? '—'}`,
    `PR: ${run.prUrl ?? '—'}`,
    `Updated: ${run.updatedAt}`,
    '',
  ]
  const body =
    activity.length === 0
      ? ['No activity recorded yet.']
      : activity.map((entry) => {
          const label = entry.toolName ? `${entry.kind}:${entry.toolName}` : entry.kind
          return `[${entry.createdAt}] ${label}\n${sanitizeActivityRaw(entry.content)}\n`
        })
  downloadBlob(`${run.id}-transcript.txt`, [...header, ...body].join('\n'), 'text/plain;charset=utf-8')
}

export async function downloadEvidenceBundle(run: Pick<RunType, 'id'>) {
  const bundle = await api.getAuditBundle(run.id)
  downloadBlob(`${run.id}-evidence-bundle.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8')
}

export async function downloadEvidenceBundleByRunId(runId: string) {
  const bundle = await api.getAuditBundle(runId)
  downloadBlob(`${runId}-evidence-bundle.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8')
}

function downloadBlob(fileName: string, body: string, type: string) {
  const blob = new Blob([body], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
