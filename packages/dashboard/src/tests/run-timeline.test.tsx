import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Evidence, GateEvaluation, RunActivity, RunStageTransition, RunUpdate } from '@/api/client'
import { RunTimeline } from '@/pages/run-detail/run-timeline'

describe('RunTimeline', () => {
  it('orders mixed attempt events newest first and links evidence ids', () => {
    render(
      <RunTimeline
        sseStatus="connected"
        activity={[activity({ id: 1, createdAt: '2026-06-19T12:02:00.000Z', content: 'TOKEN=super-secret while thinking' })]}
        evidence={[evidence({ id: 'ev_cancel', createdAt: '2026-06-19T12:03:00.000Z', type: 'operator.cancel', payload: { kind: 'operator.cancel' } })]}
        transitions={[transition({ id: 1, createdAt: '2026-06-19T12:01:00.000Z' })]}
        gates={[gate({ id: 1, createdAt: '2026-06-19T12:02:30.000Z', result: 'blocked', reason: 'CI missing' })]}
        decisions={[]}
        updates={[update({ id: 1, createdAt: '2026-06-19T12:04:00.000Z', message: 'operator approved run; merging' })]}
      />,
    )

    const updateRow = screen.getByText('operator approved run; merging')
    const evidenceRow = screen.getAllByText('operator.cancel')[0]!
    const transitionRow = screen.getByText('Understanding -> Implementing')
    expect(updateRow.compareDocumentPosition(evidenceRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(evidenceRow.compareDocumentPosition(transitionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('evidence ev_cancel')).toBeInTheDocument()
    expect(screen.getByText(/TOKEN=\[hidden\]/)).toBeInTheDocument()
    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument()
  })

  it('shows SSE state and toggles live follow', () => {
    render(<RunTimeline sseStatus="reconnecting" activity={[]} evidence={[]} transitions={[]} gates={[]} decisions={[]} updates={[]} />)

    expect(screen.getByText('SSE reconnecting')).toBeInTheDocument()
    expect(screen.getByText('No timeline events recorded yet.')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Live follow on' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Live follow off' })).toBeInTheDocument()
  })

  it('sanitizes progress update text before rendering', () => {
    render(
      <RunTimeline
        sseStatus="connected"
        activity={[]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[]}
        updates={[update({ message: 'Known red contains [redacted] token marker' })]}
      />,
    )

    expect(screen.getByText(/Known red contains \[hidden\] token marker/)).toBeInTheDocument()
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
  })
})

function transition(overrides: Partial<RunStageTransition> = {}): RunStageTransition {
  return {
    id: overrides.id ?? 1,
    runId: 'run_abc123',
    fromStage: 'understand',
    toStage: 'implement',
    reason: null,
    createdAt: overrides.createdAt ?? '2026-06-19T12:00:00.000Z',
  }
}

function gate(overrides: Partial<GateEvaluation> = {}): GateEvaluation {
  return {
    id: overrides.id ?? 1,
    runId: 'run_abc123',
    gateType: 'gate_check',
    target: 'ship',
    result: overrides.result ?? 'allowed',
    reason: overrides.reason ?? null,
    observed: false,
    createdAt: overrides.createdAt ?? '2026-06-19T12:00:00.000Z',
  }
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: overrides.id ?? 'ev1',
    runId: 'run_abc123',
    type: overrides.type ?? 'ci',
    payload: overrides.payload ?? {},
    createdAt: overrides.createdAt ?? '2026-06-19T12:00:00.000Z',
  }
}

function activity(overrides: Partial<RunActivity> = {}): RunActivity {
  return {
    id: overrides.id ?? 1,
    runId: 'run_abc123',
    kind: 'text',
    content: overrides.content ?? 'working',
    toolName: null,
    createdAt: overrides.createdAt ?? '2026-06-19T12:00:00.000Z',
  }
}

function update(overrides: Partial<RunUpdate> = {}): RunUpdate {
  return {
    id: overrides.id ?? 1,
    runId: 'run_abc123',
    message: overrides.message ?? 'operator update',
    createdAt: overrides.createdAt ?? '2026-06-19T12:00:00.000Z',
  }
}
