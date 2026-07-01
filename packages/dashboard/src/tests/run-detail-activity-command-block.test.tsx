import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActivityTab } from '@/pages/run-detail/activity-tab'
import type { RunActivity } from '@/api/client'

// Split out of run-detail-activity.test.tsx during P1 review round 3 so the
// original file stays under the 300 LOC file-size gate. These tests pin the
// CommandBlock bounding behavior for Bash commands (issue #211): long shell
// commands must land in a height-capped, copyable code surface instead of
// being dumped as multi-KB wrapped prose.

const now = '2026-06-15T12:00:00.000Z'

function row(partial: Partial<RunActivity>): RunActivity {
  return {
    id: partial.id ?? 1,
    runId: 'run_abc123',
    kind: partial.kind ?? 'summary',
    content: partial.content ?? '',
    toolName: partial.toolName ?? null,
    createdAt: partial.createdAt ?? now,
  }
}

describe('RunDetail ActivityTab CommandBlock bounding', () => {
  it('bounds plain-string Bash tool calls in a CommandBlock (codex app-server / API route shape)', () => {
    // Real Bash tool_call activity reaches the dashboard as a plain command
    // string (codex app-server handler emits `content: command`; the
    // run-activity route test posts `content: 'tail -40'`). The activity tab
    // must lift those into the same bounded CommandBlock as JSON payloads.
    const longTail = 'D'.repeat(300)
    const longCommand = `tail -f ${longTail} TOKEN=super-secret-value`
    const { container } = render(<ActivityTab activity={[row({
      kind: 'tool_call',
      toolName: 'Bash',
      content: longCommand,
    })]} />)

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

  it('does not show the literal "shell command below" filler when a Bash command has no description', () => {
    // Review round 3: when the bounded CommandBlock owns the payload and the
    // tool-call row has no description, the row used to print the literal
    // filler `shell command below` next to the tool name. That read as junk
    // text under the tool name with no value once the actual command
    // rendered below. Pin the absence so the regression cannot return.
    render(<ActivityTab activity={[row({
      kind: 'tool_call',
      toolName: 'Bash',
      content: JSON.stringify({ command: 'pnpm test' }),
    })]} />)

    expect(screen.queryByText('shell command below')).not.toBeInTheDocument()
    // The CommandBlock still renders the actual command, and the copy action
    // is still reachable.
    expect(screen.getByText(/pnpm test/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy.*shell command/i })).toBeInTheDocument()
  })

  it('bounds approval-requested Bash commands serialized as plain text in a CommandBlock', async () => {
    // `approval requested: Bash git push` is the harness's canonical shape for
    // a Codex Bash approval (canonical-events.test.ts). The summary group
    // routes that through OperatorMessage, which must still show the command in
    // a bounded block instead of `- <multi-KB command>` inline prose.
    const longTail = 'E'.repeat(300)
    const longCommand = `git push ${longTail} TOKEN=super-secret-value`
    const { container } = render(<ActivityTab activity={[row({
      kind: 'summary',
      toolName: 'Bash',
      content: `approval requested: Bash ${longCommand}`,
    })]} />)

    const commandPre = Array.from(container.querySelectorAll('pre'))
      .find((node) => node.textContent?.includes(longTail))
    expect(commandPre).toBeTruthy()
    expect(commandPre!.className).toMatch(/max-h-40/)
    expect(commandPre!.textContent).toMatch(/TOKEN=\[hidden\]/)
    expect(commandPre!.textContent).not.toMatch(/super-secret-value/)
    expect(screen.getByRole('button', { name: /copy.*shell command/i })).toBeInTheDocument()
    // The duplicate `- <command>` meta is suppressed once the CommandBlock owns
    // the payload, so the long command is not also wrapped as inline prose.
    const metaDump = Array.from(container.querySelectorAll('span'))
      .find((node) => node.textContent?.includes(longTail))
    expect(metaDump).toBeUndefined()

    // Review round 4 (D186): the copy button writes the same redacted value
    // that the <pre> renders — display and clipboard must agree. Earlier rounds
    // routed the original unredacted command to the clipboard while the screen
    // showed `TOKEN=[hidden]`; that was the only UI path that surfaced a live
    // secret through the dashboard. The clipboard now mirrors the displayed
    // text, so `super-secret` tokens never reach `navigator.clipboard.writeText`
    // from this UI.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: /copy.*shell command/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0]![0] as string
    expect(copied).not.toMatch(/super-secret-value/)
    expect(copied).toMatch(/TOKEN=\[hidden\]/)
    expect(copied).toBe(commandPre!.textContent)
  })
})
