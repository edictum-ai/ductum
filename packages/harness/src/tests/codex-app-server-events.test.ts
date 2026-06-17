import { describe, expect, it } from 'vitest'

import {
  getCodexItemId,
  resolveCodexCommandApproval,
  resolveCodexCompletedToolResult,
  resolveCodexCompletedToolResults,
  type PendingCodexToolApproval,
} from '../codex-app-server-events.js'

describe('codex app-server event mapping', () => {
  const bashApproval: PendingCodexToolApproval = {
    toolName: 'Bash',
    args: { command: 'cat README.md' },
  }

  it('maps successful completed command executions to tool result events', () => {
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command: 'cat README.md',
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: 'hello',
      },
    }, bashApproval)).toEqual({
      type: 'tool.result',
      toolName: 'Bash',
      args: { command: 'cat README.md' },
      content: 'hello',
      success: true,
    })
  })

  it('does not infer success for failed command executions', () => {
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command: 'grep missing README.md',
        status: 'completed',
        exitCode: 1,
        aggregatedOutput: '',
      },
    }, bashApproval)).toMatchObject({ success: false })
  })

  it('infers successful trusted read commands that did not need approval', () => {
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command: 'cat README.md',
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: '# Ductum',
      },
    }, null)).toEqual({
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: 'README.md' },
      content: '# Ductum',
      success: true,
    })
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'commandExecution',
        id: 'item-2',
        command: 'pnpm test',
        status: 'completed',
        exitCode: 0,
      },
    }, null)).toBeNull()
  })

  it('maps completed file changes to Write result events', () => {
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'fileChange',
        id: 'item-2',
        status: 'completed',
        changes: [{ path: 'README.md' }],
      },
    }, { toolName: 'Write', args: { itemId: 'item-2' } })).toEqual({
      type: 'tool.result',
      toolName: 'Write',
      args: { changes: [{ path: 'README.md' }] },
      content: '',
      success: true,
    })
  })

  it('extracts item ids from approval params and completed notifications', () => {
    expect(getCodexItemId({ itemId: 'approval-item' })).toBe('approval-item')
    expect(getCodexItemId({ item: { id: 'completed-item' } })).toBe('completed-item')
  })

  it('maps simple shell file reads to Read evidence for workflow advancement', () => {
    const approval = resolveCodexCommandApproval('/bin/zsh -lc "cat README.md"')
    expect(approval).toEqual({
      toolName: 'Read',
      args: { file_path: 'README.md' },
    })
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command: '/bin/zsh -lc "cat README.md"',
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: '# Ductum',
      },
    }, approval)).toMatchObject({
      toolName: 'Read',
      args: { file_path: 'README.md' },
      success: true,
    })
    expect(resolveCodexCommandApproval("sed -n '1,80p' ./CLAUDE.md")).toEqual({
      toolName: 'Read',
      args: { file_path: 'CLAUDE.md' },
    })
    expect(resolveCodexCommandApproval('rg -n Ductum packages/core/src/enforce.ts')).toEqual({
      toolName: 'Read',
      args: { file_path: 'packages/core/src/enforce.ts' },
    })
  })

  it('maps compound read-only exploration that reads README to workflow Read evidence', () => {
    expect(resolveCodexCommandApproval('/bin/zsh -lc "printf \'--- README.md ---\\n\'; sed -n \'1,80p\' README.md; printf \'\\n--- AGENTS.md ---\\n\'; sed -n \'1,80p\' AGENTS.md"')).toMatchObject({
      toolName: 'Read',
      args: { file_path: 'README.md' },
    })
    expect(resolveCodexCommandApproval('/bin/zsh -lc "pwd && ls -la && printf \'\\n--- README.md ---\\n\' && sed -n \'1,220p\' README.md && for f in decisions/053* decisions/054*; do echo \\"\\n### $f ###\\"; sed -n \'1,80p\' \\"$f\\"; done"')).toEqual({
      toolName: 'Read',
      args: { file_path: 'README.md' },
    })
    expect(resolveCodexCommandApproval('/bin/zsh -lc "sed -n \'1,220p\' README.md && for f in decisions/053* decisions/054*; do [ -f \\"$f\\" ] || continue; printf \\"\\n### %s ###\\\\n\\" \\"$f\\"; sed -n \'1,80p\' \\"$f\\"; done"')).toEqual({
      toolName: 'Read',
      args: { file_path: 'README.md' },
    })
    expect(resolveCodexCommandApproval('cat README.md && cat CLAUDE.md')).toEqual({
      toolName: 'Read',
      args: { file_path: 'README.md' },
      workflowEvidence: [
        { toolName: 'Read', args: { file_path: 'README.md' } },
        { toolName: 'Read', args: { file_path: 'CLAUDE.md' } },
      ],
    })
  })

  it('emits extra workflow evidence without duplicating compound command output', () => {
    const approval = resolveCodexCommandApproval('cat README.md && cat CLAUDE.md')
    expect(resolveCodexCompletedToolResults({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command: 'cat README.md && cat CLAUDE.md',
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: '# Ductum\n# CLAUDE',
      },
    }, approval)).toEqual([
      {
        type: 'tool.result',
        toolName: 'Read',
        args: { file_path: 'README.md' },
        content: '# Ductum\n# CLAUDE',
        success: true,
      },
      {
        type: 'tool.result',
        toolName: 'Read',
        args: { file_path: 'CLAUDE.md' },
        content: '',
        success: true,
      },
    ])
  })

  it('emits workflow evidence for unapproved SPEC and AGENTS shell reads', () => {
    const command = "/bin/zsh -lc \"sed -n '1,220p' SPEC.md && sed -n '1,180p' AGENTS.md\""
    expect(resolveCodexCompletedToolResults({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command,
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: '# Spec\n# Agents',
      },
    }, null)).toEqual([
      {
        type: 'tool.result',
        toolName: 'Read',
        args: { file_path: 'SPEC.md' },
        content: '# Spec\n# Agents',
        success: true,
      },
      {
        type: 'tool.result',
        toolName: 'Read',
        args: { file_path: 'AGENTS.md' },
        content: '',
        success: true,
      },
    ])
  })

  it('emits workflow evidence for Codex target inspection commands', () => {
    const command = "/bin/zsh -lc \"pwd && ls -la && printf '\\nqratum?\\n' && ls -la /Users/acartagena/project/qratum 2>/dev/null || true && printf '\\nRead AGENTS/README current\\n' && sed -n '1,220p' AGENTS.md && printf '\\n--- README ---\\n' && sed -n '1,240p' README.md\""
    expect(resolveCodexCompletedToolResults({
      item: { type: 'commandExecution', id: 'item-1', command, status: 'completed', exitCode: 0 },
    }, null).map((event) => event.args)).toEqual([
      { file_path: 'AGENTS.md' },
      { file_path: 'README.md' },
    ])
  })

  it('emits MCP tool call activity without recording workflow evidence', () => {
    expect(resolveCodexCompletedToolResult({
      item: {
        type: 'mcpToolCall',
        id: 'item-mcp',
        server: 'ductum_run_abc123',
        tool: 'ductum.workflow',
        arguments: {},
        status: 'completed',
        result: { content: [{ type: 'text', text: 'Workflow rules.' }] },
        error: null,
      },
    }, null)).toEqual({
      type: 'tool.result',
      toolName: 'ductum_run_abc123.ductum.workflow',
      args: {},
      content: JSON.stringify({ content: [{ type: 'text', text: 'Workflow rules.' }] }),
      success: undefined,
    })
  })

  it('keeps compound commands without a clear workflow read target as Bash evidence', () => {
    expect(resolveCodexCommandApproval('cat packages/core/package.json && cat packages/api/package.json')).toEqual({
      toolName: 'Bash',
      args: { command: 'cat packages/core/package.json && cat packages/api/package.json' },
    })
    expect(resolveCodexCommandApproval('/bin/zsh -lc "cat README.md && for f in decisions/*; do [ -f \\"$f\\" ] || continue; rm \\"$f\\"; done"')).toEqual({
      toolName: 'Bash',
      args: { command: '/bin/zsh -lc "cat README.md && for f in decisions/*; do [ -f \\"$f\\" ] || continue; rm \\"$f\\"; done"' },
    })
  })

  it('emits Read evidence for compound exploration with env inspection tail', () => {
    const command = "/bin/zsh -lc \"pwd && echo '--- README.md ---' && sed -n '1,200p' README.md && echo '--- CLAUDE.md ---' && sed -n '1,200p' CLAUDE.md && echo '--- env task hints ---' && env | grep -E 'DUCTUM|TASK|RUN|CODEX' | sort\""
    const approval = resolveCodexCommandApproval(command)
    expect(approval).toEqual({
      toolName: 'Read',
      args: { file_path: 'README.md' },
      workflowEvidence: [
        { toolName: 'Read', args: { file_path: 'README.md' } },
        { toolName: 'Read', args: { file_path: 'CLAUDE.md' } },
      ],
    })
    const results = resolveCodexCompletedToolResults({
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command,
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: '# Ductum\n...',
      },
    }, approval)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: 'README.md' },
      success: true,
      content: '# Ductum\n...',
    })
    expect(results[1]).toEqual({
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: 'CLAUDE.md' },
      content: '',
      success: true,
    })
  })

  it('keeps env-with-arguments compound commands as Bash evidence', () => {
    expect(resolveCodexCommandApproval("/bin/zsh -lc \"sed -n '1,80p' README.md && env python script.py\"")).toEqual({
      toolName: 'Bash',
      args: { command: "/bin/zsh -lc \"sed -n '1,80p' README.md && env python script.py\"" },
    })
    expect(resolveCodexCommandApproval('env VAR=value command')).toEqual({
      toolName: 'Bash',
      args: { command: 'env VAR=value command' },
    })
  })
})
