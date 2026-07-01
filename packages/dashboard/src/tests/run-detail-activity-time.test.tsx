import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RunActivity } from '@/api/client'
import { formatTime } from '@/lib/utils'
import { SignalActivityPreview } from '@/pages/run-detail/signal-panels'

describe('SignalActivityPreview', () => {
  it('uses the shared local time formatter instead of a UTC seconds slice', () => {
    const createdAt = '2026-01-01T23:05:00.000Z'
    const activity: RunActivity[] = [{
      id: 1,
      runId: 'run_abc123',
      kind: 'tool_call',
      content: 'opened file',
      toolName: 'Read',
      createdAt,
    }]

    render(<SignalActivityPreview activity={activity} />)

    expect(screen.getByText(formatTime(createdAt))).toBeInTheDocument()
    expect(screen.queryByText('23:05:00')).not.toBeInTheDocument()
  })
})
