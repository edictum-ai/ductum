import type { RunActivity } from '@/api/client'
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
  const blob = new Blob([[...header, ...body].join('\n')], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${run.id}-transcript.txt`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
