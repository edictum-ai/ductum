import { useState, type FormEvent } from 'react'

import { Btn, Caps, Card, Mono, tokens } from '@/components/signal'
import type { RunType } from './types'

export function RunCancelCard({
  run,
  isPending,
  error,
  onCancel,
}: {
  run: RunType
  isPending: boolean
  error: unknown
  onCancel: (input: { runId: string; reason: string; cleanupWorktree: boolean }) => void
}) {
  const [reason, setReason] = useState('')
  const [cleanupWorktree, setCleanupWorktree] = useState(false)
  const canSubmit = reason.trim().length > 0 && !isPending

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    onCancel({ runId: run.id, reason: reason.trim(), cleanupWorktree })
  }

  return (
    <Card style={{ marginBottom: 24, borderColor: `color-mix(in oklab, ${tokens.err} 28%, ${tokens.hair})` }}>
      <form onSubmit={submit}>
        <Caps color={tokens.err}>Operator cancel</Caps>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
          <input
            aria-label="Cancel reason"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="reason"
            style={{
              width: '100%',
              minWidth: 180,
              border: `1px solid ${tokens.rule}`,
              borderRadius: 7,
              background: tokens.sunken,
              color: tokens.fg,
              padding: '8px 10px',
              fontFamily: tokens.sans,
              fontSize: 13,
            }}
          />
          <Btn danger type="submit" disabled={!canSubmit}>Cancel attempt</Btn>
        </div>
        <label style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, color: tokens.mid, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={cleanupWorktree}
            onChange={(event) => setCleanupWorktree(event.currentTarget.checked)}
            aria-label="Cleanup worktree"
          />
          Cleanup worktree
        </label>
        {error != null && (
          <Mono color={tokens.err} style={{ display: 'block', marginTop: 10 }}>
            {error instanceof Error ? error.message : 'Cancel failed'}
          </Mono>
        )}
      </form>
    </Card>
  )
}
