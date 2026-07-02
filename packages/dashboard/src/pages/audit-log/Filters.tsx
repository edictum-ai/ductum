import { Search, X } from 'lucide-react'
import type { FormEvent } from 'react'

import { Btn, compactFieldStyle, fieldStyle, Mono, tokens } from '@/components/signal'
import type { AuditFilterKey } from './helpers'
import { AUDIT_FILTER_KEYS } from './helpers'

const FILTER_LABELS: Record<AuditFilterKey, string> = {
  actor: 'Actor',
  project: 'Project name',
  projectId: 'Project ID',
  specId: 'Spec ID',
  taskId: 'Task ID',
  runId: 'Attempt ID',
  eventType: 'Event type',
  status: 'Status',
  from: 'From',
  to: 'To',
}

const FILTER_PLACEHOLDERS: Record<AuditFilterKey, string> = {
  actor: 'operator, glm, codex',
  project: 'ductum',
  projectId: 'project id',
  specId: 'spec id',
  taskId: 'task id',
  runId: 'attempt id',
  eventType: 'run.stage',
  status: 'success',
  from: '2026-07-01T00:00:00Z',
  to: '2026-07-02T00:00:00Z',
}

export function AuditLogFilters({
  params,
  onApply,
  onClear,
}: {
  params: URLSearchParams
  onApply: (next: URLSearchParams) => void
  onClear: () => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const next = new URLSearchParams()
    for (const key of AUDIT_FILTER_KEYS) {
      const value = String(form.get(key) ?? '').trim()
      if (value !== '') next.set(key, value)
    }
    next.set('limit', params.get('limit') || '50')
    onApply(next)
  }

  return (
    <form
      key={params.toString()}
      aria-label="Audit log filters"
      onSubmit={submit}
      style={{
        border: `1px solid ${tokens.hair}`,
        borderRadius: 10,
        background: tokens.canvas,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 10,
        }}
      >
        {AUDIT_FILTER_KEYS.map((key) => (
          <label key={key} style={{ display: 'grid', gap: 5 }}>
            <Mono size={10.5} color={tokens.dim}>{FILTER_LABELS[key]}</Mono>
            <input
              name={key}
              aria-label={FILTER_LABELS[key]}
              defaultValue={params.get(key) ?? ''}
              placeholder={FILTER_PLACEHOLDERS[key]}
              style={key === 'from' || key === 'to' ? fieldStyle : compactFieldStyle}
            />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
        <Btn type="button" ghost onClick={onClear}>
          <X size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          Clear
        </Btn>
        <Btn type="submit" primary>
          <Search size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          Apply filters
        </Btn>
      </div>
    </form>
  )
}
