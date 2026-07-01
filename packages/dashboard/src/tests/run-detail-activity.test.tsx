import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ActivityTab } from '@/pages/run-detail/activity-tab'
import type { RunActivity } from '@/api/client'

const now = '2026-06-15T12:00:00.000Z'
const embeddedGenericToken = 'AbC123xyZ456mnopQR789stuV012wxyzAB'

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

describe('RunDetail ActivityTab', () => {
  it('translates approval summaries and keeps sanitized raw payload expandable', () => {
    render(<ActivityTab activity={[row({
      content: 'approval requested: Write {"threadId":"t1","turnId":"u1","itemId":"i1","file_path":"/Users/acartagena/project/ductum/packages/core/src/run.ts"}',
      toolName: 'Write',
    })]} />)

    expect(screen.getByText(/Approval requested to edit files/)).toBeInTheDocument()
    expect(screen.getByText(/packages\/core\/src\/run\.ts/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Approval requested to edit files/ }))
    expect(screen.getAllByText(/packages\/core\/src\/run\.ts/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('hides internal-only approval payload ids through raw expansion', () => {
    render(<ActivityTab activity={[row({
      content: 'approval requested: Write {"threadId":"t1","turnId":"u1","itemId":"i1"}',
      toolName: 'Write',
    })]} />)

    expect(screen.getByText(/Approval requested to edit files/)).toBeInTheDocument()
    expect(screen.getByText(/internal approval payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Approval requested to edit files/ }))
    expect(screen.getByText(/internal payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('hides internal-only tool-call payload ids through raw expansion', () => {
    render(<ActivityTab activity={[row({
      kind: 'tool_call',
      content: '{"threadId":"t1","turnId":"u1","itemId":"i1","startedAtMs":123}',
      toolName: 'Write',
    })]} />)

    expect(screen.getByText(/Edit file/)).toBeInTheDocument()
    expect(screen.getByText(/internal tool payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Edit file/ }))
    expect(screen.getByText(/internal payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('hides mixed internal tool-call payload ids when edit args are nested', () => {
    render(<ActivityTab activity={[row({
      kind: 'tool_call',
      content: JSON.stringify({
        threadId: 't1',
        turnId: 'u1',
        itemId: 'i1',
        args: {
          file_path: '/Users/acartagena/project/ductum/packages/core/src/run.ts',
          old_string: 'before',
          new_string: 'after',
        },
      }),
      toolName: 'Edit',
    })]} />)

    expect(screen.getByText(/Edit file/)).toBeInTheDocument()
    expect(screen.getByText(/packages\/core\/src\/run\.ts \(edit\)/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Edit file/ }))
    expect(screen.getAllByText(/packages\/core\/src\/run\.ts/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('redacts secrets in collapsed and expanded activity rows', () => {
    render(<ActivityTab activity={[
      row({
        id: 1,
        kind: 'tool_call',
        content: JSON.stringify({ command: 'TOKEN=super-secret-value node scripts/check.mjs' }),
        toolName: 'Bash',
      }),
      row({ id: 2, kind: 'text', content: 'TOKEN=super-secret-value while thinking' }),
      row({ id: 3, kind: 'summary', content: 'Finished with TOKEN=super-secret-value' }),
    ]} />)

    expect(screen.getByText(/TOKEN=\[hidden\] node scripts\/check\.mjs/)).toBeInTheDocument()
    expect(screen.getByText(/TOKEN=\[hidden\] while thinking/)).toBeInTheDocument()
    expect(screen.getByText(/Finished with TOKEN=\[hidden\]/)).toBeInTheDocument()
    expect(screen.queryByText(/super-secret-value/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Run command/ }))
    expect(screen.getAllByText(/TOKEN=\[hidden\]/).length).toBeGreaterThan(2)
    expect(screen.queryByText(/super-secret-value/)).not.toBeInTheDocument()
  })

  it('redacts embedded generic high-entropy tokens in command, text, and summary rows', () => {
    render(<ActivityTab activity={[
      row({
        id: 1,
        kind: 'tool_call',
        content: JSON.stringify({ command: `echo ${embeddedGenericToken}` }),
        toolName: 'Bash',
      }),
      row({ id: 2, kind: 'text', content: `token ${embeddedGenericToken} while thinking` }),
      row({ id: 3, kind: 'summary', content: `Finished with ${embeddedGenericToken}` }),
    ]} />)

    expect(screen.getByText(/echo \[hidden\]/)).toBeInTheDocument()
    expect(screen.getByText(/token \[hidden\] while thinking/)).toBeInTheDocument()
    expect(screen.getByText(/Finished with \[hidden\]/)).toBeInTheDocument()
    expect(screen.queryByText(embeddedGenericToken)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Run command/ }))
    expect(screen.getAllByText(/\[hidden\]/).length).toBeGreaterThan(2)
    expect(screen.queryByText(embeddedGenericToken)).not.toBeInTheDocument()
  })

  it('does not treat compact approval payload JSON as the visible tool name', () => {
    render(<ActivityTab activity={[row({
      content: 'approval requested: {"threadId":"t1","turnId":"u1","itemId":"i1"}',
    })]} />)

    expect(screen.getByText(/^Approval requested$/)).toBeInTheDocument()
    expect(screen.getByText(/internal approval payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Approval requested/ }))
    expect(screen.getByText(/internal payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('translates JSON-string tool args without showing internal ids in the collapsed row', () => {
    render(<ActivityTab activity={[row({
      kind: 'tool_call',
      content: JSON.stringify({
        args: JSON.stringify({
          threadId: 't1',
          file_path: '/Users/acartagena/project/ductum/packages/dashboard/src/pages/RunDetail.tsx',
          content: 'updated',
        }),
      }),
      toolName: 'Write',
    })]} />)

    expect(screen.getByText(/Edit file/)).toBeInTheDocument()
    expect(screen.getByText(/packages\/dashboard\/src\/pages\/RunDetail\.tsx \(write\)/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Edit file/ }))
    expect(screen.getAllByText(/packages\/dashboard\/src\/pages\/RunDetail\.tsx/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('hides malformed structured-looking tool args until raw expansion', () => {
    render(<ActivityTab activity={[row({
      kind: 'tool_call',
      content: '{"threadId":"t1","args":',
      toolName: 'mcp__ductum__ductum_record_evidence',
    })]} />)

    expect(screen.getByText(/Ductum: Record evidence/)).toBeInTheDocument()
    expect(screen.getByText(/tool args hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Ductum: Record evidence/ }))
    expect(screen.getByText(/internal payload hidden/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId/)).not.toBeInTheDocument()
  })

  it('translates MCP prompts, validation errors, and JSON results', () => {
    render(<ActivityTab activity={[
      row({ id: 1, kind: 'text', content: 'McpElicitation ductum_run_fykqne: Allow agent to run tool "ductum.complete"?' }),
      row({ id: 2, kind: 'result', content: "CHECK constraint failed: type IN ('ci','review','test','lint','custom')" }),
      row({ id: 3, kind: 'tool_result', content: '{"ok":true,"boundRunId":"run_abc123"}', toolName: 'mcp__ductum__ductum_gate_check' }),
    ]} />)

    expect(screen.getByText(/Agent asked to finish attempt/)).toBeInTheDocument()
    expect(screen.getByText(/Evidence rejected: unsupported evidence type/)).toBeInTheDocument()
    expect(screen.getByText(/Check workflow gate succeeded/)).toBeInTheDocument()
  })

  it('shows NDJSON activity as a summary first and keeps raw lines behind the debug toggle', () => {
    render(<ActivityTab activity={[row({
      kind: 'text',
      content: [
        '{"type":"message","message":"Planner step started"}',
        '{"type":"tool_call","toolName":"Write","args":{"file_path":"/project/ductum/packages/dashboard/src/pages/RunDetail.tsx","content":"updated"}}',
      ].join('\n'),
    })]} />)

    expect(screen.getByText(/Structured activity payload \(2 events\)/)).toBeInTheDocument()
    expect(screen.getByText(/message · tool call/)).toBeInTheDocument()
    expect(screen.queryByText(/Planner step started/)).not.toBeInTheDocument()
    expect(screen.queryByText(/toolName/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Structured activity payload \(2 events\)/ }))
    expect(screen.getByText(/Planner step started/)).toBeInTheDocument()
    expect(screen.getAllByText(/packages\/dashboard\/src\/pages\/RunDetail\.tsx/).length).toBeGreaterThan(0)
  })

  it('summarizes raw structured tool payloads before showing debug details', () => {
    render(<ActivityTab activity={[row({
      kind: 'text',
      content: '{"toolName":"Write","args":{"file_path":"/project/ductum/packages/dashboard/src/pages/RunDetail.tsx","content":"updated"}}',
    })]} />)

    expect(screen.getByText(/Edit file/)).toBeInTheDocument()
    expect(screen.getByText(/packages\/dashboard\/src\/pages\/RunDetail\.tsx \(write\)/)).toBeInTheDocument()
    expect(screen.queryByText(/toolName/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Edit file/ }))
    expect(screen.getAllByText(/packages\/dashboard\/src\/pages\/RunDetail\.tsx/).length).toBeGreaterThan(0)
  })

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

  it('bounds approval-requested Bash commands serialized as plain text in a CommandBlock', () => {
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
  })
})
