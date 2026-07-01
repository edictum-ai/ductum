import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Evidence, GateEvaluation, RunActivity, RunStageTransition, RunUpdate } from '@/api/client'
import { formatTime } from '@/lib/utils'
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

  it('bounds long shell commands in a scrollable code block with a copy action instead of wrapped prose', async () => {
    const longTail = 'A'.repeat(300)
    const longCommand = `pnpm --filter @ductum/dashboard test -- ${longTail} TOKEN=super-secret-value`
    const { container } = render(
      <RunTimeline
        sseStatus="connected"
        activity={[activity({
          id: 7,
          kind: 'tool_call',
          toolName: 'Bash',
          createdAt: '2026-06-19T12:05:00.000Z',
          content: JSON.stringify({ command: longCommand, description: 'run dashboard tests' }),
        })]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[]}
        updates={[]}
      />,
    )

    // The whole multi-hundred-char command lands in a bounded <pre> that is
    // height-capped and scrollable, not clipped to a 160-char compact() slice.
    const commandPre = Array.from(container.querySelectorAll('pre'))
      .find((node) => node.textContent?.includes(longTail))
    expect(commandPre).toBeTruthy()
    expect(commandPre!.className).toMatch(/max-h-40/)
    expect(commandPre!.className).toMatch(/overflow-auto/)
    // Secrets inside the command are still redacted inside the bounded block.
    expect(commandPre!.textContent).toMatch(/TOKEN=\[hidden\]/)
    expect(commandPre!.textContent).not.toMatch(/super-secret-value/)
    // Accessible copy affordance is present.
    expect(screen.getByRole('button', { name: /copy.*shell command/i })).toBeInTheDocument()
    // The long command is no longer dumped as unbounded wrapped prose.
    const proseDump = Array.from(container.querySelectorAll('p'))
      .find((node) => node.textContent?.includes(longTail))
    expect(proseDump).toBeUndefined()

    // Review round 4 (D186): the copy button must write the same redacted
    // value that is rendered in the <pre>. Earlier rounds routed the original
    // unredacted command to the clipboard while the screen stayed redacted —
    // that was the only UI path that surfaced a live secret through the
    // dashboard, and the `Copy shell command` label did not disclose the
    // asymmetry. The clipboard now mirrors the displayed text: `super-secret`
    // tokens never reach `navigator.clipboard.writeText` from this UI.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: /copy.*shell command/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0]![0] as string
    expect(copied).not.toMatch(/super-secret-value/)
    expect(copied).toMatch(/TOKEN=\[hidden\]/)
    // The clipboard value is exactly the displayed <pre> textContent — display
    // and clipboard cannot drift.
    expect(copied).toBe(commandPre!.textContent)
  })

  it('bounds plain-string Bash tool calls (codex app-server and API route shapes) in the same code block', () => {
    // Real Bash tool_call activity reaches the dashboard as a plain command
    // string, not JSON: packages/harness/src/codex-app-server-handlers.ts
    // emits `content: command` and the run-activity route test posts
    // `content: 'tail -40'`. Those shapes must also land in a CommandBlock.
    const longTail = 'B'.repeat(300)
    const longCommand = `tail -f ${longTail} TOKEN=super-secret-value`
    const { container } = render(
      <RunTimeline
        sseStatus="connected"
        activity={[activity({
          id: 11,
          kind: 'tool_call',
          toolName: 'Bash',
          createdAt: '2026-06-19T12:06:00.000Z',
          content: longCommand,
        })]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[]}
        updates={[]}
      />,
    )

    const commandPre = Array.from(container.querySelectorAll('pre'))
      .find((node) => node.textContent?.includes(longTail))
    expect(commandPre).toBeTruthy()
    expect(commandPre!.className).toMatch(/max-h-40/)
    expect(commandPre!.className).toMatch(/overflow-auto/)
    expect(commandPre!.textContent).toMatch(/TOKEN=\[hidden\]/)
    expect(commandPre!.textContent).not.toMatch(/super-secret-value/)
    expect(screen.getByRole('button', { name: /copy.*shell command/i })).toBeInTheDocument()
    const proseDump = Array.from(container.querySelectorAll('p'))
      .find((node) => node.textContent?.includes(longTail))
    expect(proseDump).toBeUndefined()
  })

  it('bounds approval-requested Bash commands that the harness serializes as plain text', () => {
    // packages/harness/src/canonical-events.test.ts pins the producer shape
    // `approval requested: Bash git push`. When the command grows to multi-KB
    // the timeline must still lift it into a CommandBlock instead of wrapping
    // it as title/meta prose.
    const longTail = 'C'.repeat(300)
    const longCommand = `git push ${longTail} TOKEN=super-secret-value`
    const { container } = render(
      <RunTimeline
        sseStatus="connected"
        activity={[activity({
          id: 12,
          kind: 'summary',
          toolName: 'Bash',
          createdAt: '2026-06-19T12:07:00.000Z',
          content: `approval requested: Bash ${longCommand}`,
        })]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[]}
        updates={[]}
      />,
    )

    const commandPre = Array.from(container.querySelectorAll('pre'))
      .find((node) => node.textContent?.includes(longTail))
    expect(commandPre).toBeTruthy()
    expect(commandPre!.className).toMatch(/max-h-40/)
    expect(commandPre!.textContent).toMatch(/TOKEN=\[hidden\]/)
    expect(commandPre!.textContent).not.toMatch(/super-secret-value/)
    expect(screen.getByRole('button', { name: /copy.*shell command/i })).toBeInTheDocument()
    const proseDump = Array.from(container.querySelectorAll('p'))
      .find((node) => node.textContent?.includes(longTail))
    expect(proseDump).toBeUndefined()
  })

  it('keeps blocked Bash commands out of the bounded code block so the blocked branch keeps owning them', () => {
    // `BLOCKED: <command>` already has a dedicated red branch in ActivityTab;
    // the timeline must not duplicate it as a CommandBlock (which would also
    // drop the BLOCKED context).
    const { container } = render(
      <RunTimeline
        sseStatus="connected"
        activity={[activity({
          id: 13,
          kind: 'tool_call',
          toolName: 'Bash',
          createdAt: '2026-06-19T12:08:00.000Z',
          content: 'BLOCKED: rm -rf /tmp/sensitive',
        })]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[]}
        updates={[]}
      />,
    )

    const blockPre = Array.from(container.querySelectorAll('pre'))
      .find((node) => node.textContent?.includes('rm -rf /tmp/sensitive'))
    expect(blockPre).toBeUndefined()
  })

  it('renders timeline event timestamps through the shared timezone-aware formatter', () => {
    const at = '2026-06-19T12:02:00.000Z'
    render(
      <RunTimeline
        sseStatus="connected"
        activity={[]}
        evidence={[]}
        transitions={[transition({ createdAt: at })]}
        gates={[]}
        decisions={[]}
        updates={[]}
      />,
    )

    // The same labeled string the shared formatter produces is what the DOM
    // shows — a competing UTC slice or unlabeled local time would not match.
    expect(screen.getByText(formatTime(at))).toBeInTheDocument()
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
    kind: overrides.kind ?? 'text',
    content: overrides.content ?? 'working',
    toolName: overrides.toolName ?? null,
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
