import {
  collectWorkflowReadPathCandidates,
  createId,
  log,
} from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import {
  classifyCodexAppServerTool,
  createCodexAppServerApproval,
  loadHarnessAdaptersFromModule,
  resolveCodexAppServerAuthorizationTool,
} from '../lib/harness-loader.js'
import { authorizeTool, reportToolSuccess } from '../lib/run-ops.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

describe('harness loader', () => {
  it('classifies read-only codex app-server bash commands as Read', () => {
    expect(classifyCodexAppServerTool('Bash', { command: "/bin/zsh -lc \"sed -n '1,80p' README.md\"" })).toBe('Read')
    expect(classifyCodexAppServerTool('Bash', { command: 'cat README.md' })).toBe('Read')
    expect(classifyCodexAppServerTool('Bash', { command: "/bin/zsh -lc \"printf '--- README.md ---\\n'; sed -n '1,80p' README.md\"" })).toBe('Bash')
    expect(classifyCodexAppServerTool('Bash', { command: 'git push' })).toBe('Bash')
    expect(classifyCodexAppServerTool('Write', { file_path: 'README.md' })).toBe('Write')
  })

  it('fails closed on shell write syntax even when the command verb is normally read-only', () => {
    expect(classifyCodexAppServerTool('Bash', { command: 'echo hi > /tmp/out.txt' })).toBe('Bash')
    expect(classifyCodexAppServerTool('Bash', { command: 'cat README.md | tee /tmp/out.txt' })).toBe('Bash')
    expect(classifyCodexAppServerTool('Bash', { command: "/bin/zsh -lc \"printf 'x'; rm README.md\"" })).toBe('Bash')
  })

  it('fails closed when codex app-server authorization throws', async () => {
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => undefined)
    const approve = createCodexAppServerApproval(async () => {
      throw new Error('policy backend down')
    })

    await expect(approve('run-1' as never, 'Bash', { command: 'git push' })).resolves.toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('enforce', expect.stringContaining('policy backend down'))

    errorSpy.mockRestore()
  })

  it('routes read-only codex app-server bash approvals through Read', async () => {
    const authorizeTool = vi.fn(async () => ({ allowed: true }))
    const approve = createCodexAppServerApproval(authorizeTool)

    await expect(approve('run-1' as never, 'Bash', { command: "cat README.md" })).resolves.toBe(true)
    expect(authorizeTool).toHaveBeenCalledWith('run-1', 'Read', { file_path: 'README.md' })
  })

  it('keeps compound command approvals on the Bash command path', async () => {
    const authorizeTool = vi.fn(async () => ({ allowed: true }))
    const approve = createCodexAppServerApproval(authorizeTool)
    const command = '/bin/zsh -lc "sed -n \'1,220p\' README.md && for f in decisions/053* decisions/054*; do [ -f \\"$f\\" ] || continue; printf \\"\\n### %s ###\\\\n\\" \\"$f\\"; sed -n \'1,80p\' \\"$f\\"; done"'

    await expect(approve('run-1' as never, 'Bash', { command })).resolves.toBe(true)
    expect(authorizeTool).toHaveBeenCalledWith('run-1', 'Bash', { command })
  })

  it('passes relative read paths to authorization so path scope can block escapes', () => {
    expect(resolveCodexAppServerAuthorizationTool('Bash', { command: 'cat ../../ductum.db' })).toEqual({
      toolName: 'Read',
      args: { file_path: '../../ductum.db' },
    })
  })

  it('fails closed when read-shaped shell traversal is rejected by authorization', async () => {
    const authorizeTool = vi.fn(async (_runId, toolName, args) => ({
      allowed: !(toolName === 'Read' && args.file_path === '../../ductum.db'),
    }))
    const approve = createCodexAppServerApproval(authorizeTool)

    await expect(approve('run-1' as never, 'Bash', { command: 'cat ../../ductum.db' })).resolves.toBe(false)
    expect(authorizeTool).toHaveBeenCalledWith('run-1', 'Read', { file_path: '../../ductum.db' })
  })

  it('fails loudly when the harness module does not expose the registry loader', () => {
    expect(() => loadHarnessAdaptersFromModule({}, { apiUrl: 'http://ductum.test', enableDispatch: true }))
      .toThrow('@ductum/harness is missing loadBuiltInHarnessAdapters()')
  })

  // ---------------------------------------------------------------------
  // Codex shell-read end-to-end through the API enforcement path
  //
  // The codex app-server harness translates a recognized shell-read command
  // into multiple `Read` tool.result events (one per recognized file). This
  // test exercises the contract that matters at the API boundary:
  //   1. Authorization for a compound read-only shell command stays on the
  //      Bash command path so command-scope checks still inspect the full
  //      shell text.
  //   2. The Read evidence emitted by the harness for each recognized file
  //      flows through the existing `reportToolSuccess` path and advances
  //      the understand-stage read gate.
  //
  // Direct `Read` tool behavior is covered elsewhere — the slop pattern this
  // test attacks is "tests that only prove direct Read, not shell-read
  // recognition" called out in the P21 spec.
  // ---------------------------------------------------------------------

  describe('codex shell-read evidence end-to-end', () => {
    async function setupRun(stage: 'understand' | 'implement' = 'understand') {
      const fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage,
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'codex-session-1',
        branch: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
        worktreePaths: null,
        ciStatus: null,
        reviewStatus: null,
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })
      fixture.repos.sessionRunMappings.create({
        sessionId: 'codex-session-1',
        runId: run.id,
        harness: 'codex-app-server',
        workingDir: process.cwd(),
      })
      return { fixture, run } as { fixture: TestFixture; run: typeof run }
    }

    it('recovers from a blocked write after a supported local README read and ignores unsupported read routes', async () => {
      const { fixture, run } = await setupRun('understand')
      try {
        await expect(authorizeTool(fixture.context, run.id, 'Write', {
          file_path: 'notes.md',
          content: 'blocked until README is read',
        })).rejects.toMatchObject({
          status: 403,
          message: expect.stringContaining('Read README.md before editing'),
        })

        await reportToolSuccess(fixture.context, run.id, 'Bash', {
          command: 'gh issue view 100 --repo edictum-ai/ductum',
        })
        expect((await fixture.context.enforcement.getWorkflowState(run.id)).activeStage).toBe('understand')

        await reportToolSuccess(fixture.context, run.id, 'Read', { file_path: 'README.md' })

        const stateAfter = await fixture.context.enforcement.getWorkflowState(run.id)
        expect(stateAfter.activeStage).toBe('implement')
        expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'implement', blockedReason: null })
      } finally {
        fixture.close()
      }
    })

    it('keeps compound shell read authorization on the Bash command path while recording Read evidence per recognized file', async () => {
      const { fixture, run } = await setupRun('understand')
      try {
        // Spy through the real EnforcementManager so we can assert the
        // authorization tool name and args the harness-loader sent.
        const authorizeSpy = vi.spyOn(fixture.context.enforcement, 'authorizeTool')

        const command = '/bin/zsh -lc "sed -n \'1,200p\' README.md && sed -n \'1,200p\' CLAUDE.md"'
        const approve = createCodexAppServerApproval(async (runId, toolName, args) => {
          return await authorizeTool(fixture.context, runId, toolName, args)
        })

        // Compound read-only commands stay Bash so command-scope inspection
        // still fires; the harness-loader MUST NOT relabel them as Read.
        await expect(approve(run.id, 'Bash', { command })).resolves.toBe(true)
        expect(authorizeSpy).toHaveBeenCalledWith(run.id, 'Bash', { command })

        // Replay the harness's Read tool.result events through the existing
        // enforcement-side `reportToolSuccess` path. Conservative: only the
        // recognized read paths from the shared classifier fire as Read.
        const candidates = collectWorkflowReadPathCandidates(command)
        expect(candidates).toEqual(expect.arrayContaining(['README.md', 'CLAUDE.md']))
        for (const filePath of candidates) {
          await reportToolSuccess(fixture.context, run.id, 'Read', { file_path: filePath })
        }

        const stateAfter = await fixture.context.enforcement.getWorkflowState(run.id)
        expect(stateAfter.activeStage).toBe('implement')
        expect(fixture.repos.runs.get(run.id)?.stage).toBe('implement')

        // Sanity: the run accumulated Read evidence in the @edictum/core
        // workflow state for BOTH recognized files, not just the README
        // that satisfies the exit gate. This guards against a regression
        // where the harness drops the secondary workflowEvidence entries
        // and only the primary `Read` event lands.
        //
        // Note: `recordToolSuccess` records into the workflow runtime's
        // evidence.reads, not the SQLite evidenceRepo (which is only
        // written for blocked tool calls and watcher/dispatcher events),
        // so checking `state.evidence.reads` is the actual sink for
        // these per-file workflow read entries.
        expect([...stateAfter.evidence.reads]).toEqual(
          expect.arrayContaining(['README.md', 'CLAUDE.md']),
        )
      } finally {
        fixture.close()
      }
    })

    it('does not advance the read gate when the shell command has no recognized README read', async () => {
      const { fixture, run } = await setupRun('understand')
      try {
        // Read-only multi-package.json inspection: classifier returns paths
        // but `extractWorkflowReadPath` returns null because README.md isn't
        // in the candidate set, so nothing trips the README exit gate.
        const command = 'cat packages/core/package.json && cat packages/api/package.json'
        const candidates = collectWorkflowReadPathCandidates(command)
        expect(candidates).toEqual(['packages/core/package.json', 'packages/api/package.json'])

        const approve = createCodexAppServerApproval(async (runId, toolName, args) => {
          return await authorizeTool(fixture.context, runId, toolName, args)
        })
        await expect(approve(run.id, 'Bash', { command })).resolves.toBe(true)

        for (const filePath of candidates) {
          await reportToolSuccess(fixture.context, run.id, 'Read', { file_path: filePath })
        }

        const stateAfter = await fixture.context.enforcement.getWorkflowState(run.id)
        expect(stateAfter.activeStage).toBe('understand')
      } finally {
        fixture.close()
      }
    })

    it('does not record Read evidence for mutating shell commands even when they include a read', async () => {
      const { fixture, run } = await setupRun('understand')
      try {
        // Mixed read-and-mutate command: classifier MUST fail closed and
        // return no candidates so the harness emits Bash evidence only and
        // the read gate stays unchanged. This guards against broad
        // shell-output inference attacked by the slop review.
        const mutating = '/bin/zsh -lc "cat README.md && for f in decisions/*; do rm \\"$f\\"; done"'
        expect(collectWorkflowReadPathCandidates(mutating)).toEqual([])

        // The Bash command itself should be authorized in the understand
        // stage in this fixture (no `rm` is in the workflow's understand
        // checks since it's expressed via mutating shell control flow), but
        // even if it were authorized, recording the Bash command MUST NOT
        // produce Read evidence.
        await reportToolSuccess(fixture.context, run.id, 'Bash', { command: mutating })

        const stateAfter = await fixture.context.enforcement.getWorkflowState(run.id)
        expect(stateAfter.activeStage).toBe('understand')
      } finally {
        fixture.close()
      }
    })
  })

  it('loads adapters from the registry loader and logs each loaded harness', () => {
    const infoSpy = vi.spyOn(log, 'info').mockImplementation(() => undefined)
    const adapters = new Map([['codex-sdk', {} as never]])
    let receivedMockAgentCalls = false

    const result = loadHarnessAdaptersFromModule({
      loadBuiltInHarnessAdapters: (options) => {
        receivedMockAgentCalls = options.mockAgentCalls === true
        return {
        adapters,
        loaded: [{ id: 'codex-sdk', loadMessage: 'Harness: codex-sdk loaded' }],
        }
      },
    }, {
      apiUrl: 'http://ductum.test',
      enableDispatch: true,
      mockAgentCalls: true,
    })

    expect(result).toEqual({ harnessAdapters: adapters, harnessLoadFailed: false })
    expect(receivedMockAgentCalls).toBe(true)
    expect(infoSpy).toHaveBeenCalledWith('startup', 'Harness: codex-sdk loaded')

    infoSpy.mockRestore()
  })
})
