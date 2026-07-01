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

function tzAbbrev(iso: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? ''
}

describe('run-detail event time formatter', () => {
  it('labels every timestamp with the viewer timezone so one event cannot appear as two unexplained times', () => {
    const iso = '2026-06-19T12:02:00.000Z'
    const labeled = formatTime(iso)

    // HH:MM shape — no leaked UTC seconds slice that would read as a bare clock.
    expect(labeled).toMatch(/^\d{2}:\d{2}\s/)
    expect(labeled).not.toMatch(/\d{2}:\d{2}:\d{2}/)

    // The timezone abbreviation is present and stable for the runtime.
    const tz = tzAbbrev(iso)
    expect(tz).not.toBe('')
    expect(labeled).toContain(tz)
  })

  it('renders the activity preview time through the same timezone-aware formatter', () => {
    const iso = '2026-07-01T09:30:00.000Z'
    const activity: RunActivity[] = [{
      id: 2,
      runId: 'run_abc123',
      kind: 'tool_call',
      content: 'ran a command',
      toolName: 'Bash',
      createdAt: iso,
    }]

    render(<SignalActivityPreview activity={activity} />)

    // The DOM shows exactly the formatter's labeled output — a surface that
    // drifted to a raw UTC slice or an unlabeled local time would not match.
    const cell = screen.getByText(formatTime(iso))
    expect(cell).toBeInTheDocument()
    expect(cell.textContent).toContain(tzAbbrev(iso))
  })
})
