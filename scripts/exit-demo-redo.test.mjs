import { describe, expect, it } from 'vitest'

import {
  EXIT_DEMO_PHASES,
  ExitDemoError,
  buildExitDemoEvidence,
  errorEnvelope,
  findApiProcessFromPsOutput,
  forbiddenEnvFindings,
  machineSignature,
  selectFirstAwaitingApprovalRun,
  selectMergedRunStatus,
  validateExitDemoEvidence,
} from './demos/exit-demo-redo-lib.mjs'

const timeline = EXIT_DEMO_PHASES.map((phase, index) => ({ phase, t: (index + 1) * 1000 }))
const signature = machineSignature({ platform: 'darwin', release: '26.0.0', hostname: 'fresh-host' })

describe('exit demo redo helpers', () => {
  it('builds and validates exit_demo.run evidence', () => {
    const evidence = buildExitDemoEvidence({
      machineSignature: signature,
      timeline,
      totalMs: 7500,
      mergedCommitSha: 'abc1234',
      mergedBranch: 'main',
      agentName: 'claude-builder',
    })

    expect(validateExitDemoEvidence(evidence)).toBe(evidence)
    expect(evidence).toMatchObject({
      kind: 'exit_demo.run',
      schemaVersion: 1,
      data: {
        demoName: 'bootstrap-redesign-p5',
        machineSignature: signature,
        totalSeconds: 7.5,
        operatorActions: ['browser_auth', 'approve_click'],
      },
    })
  })

  it('rejects missing or reordered timing checkpoints', () => {
    const evidence = buildExitDemoEvidence({
      machineSignature: signature,
      timeline: [timeline[1], timeline[0], ...timeline.slice(2)],
      totalMs: 7500,
      mergedCommitSha: 'abc1234',
    })

    expect(() => validateExitDemoEvidence(evidence)).toThrow(ExitDemoError)
    expect(() => validateExitDemoEvidence(evidence)).toThrow('timeline checkpoints')
  })

  it('rejects over-budget evidence without weakening the payload shape', () => {
    const evidence = buildExitDemoEvidence({
      machineSignature: signature,
      timeline,
      totalMs: 601000,
      mergedCommitSha: 'abc1234',
    })

    expect(() => validateExitDemoEvidence(evidence)).toThrow('10 minute budget')
  })

  it('detects ambient credentials without exposing values', () => {
    expect(forbiddenEnvFindings({
      ANTHROPIC_API_KEY: 'secret',
      OPENAI_API_KEY: '',
      GH_TOKEN: 'token',
      PATH: '/bin',
    }, true)).toEqual([
      { kind: 'env', name: 'ANTHROPIC_API_KEY' },
      { kind: 'env', name: 'GH_TOKEN' },
      { kind: 'path', name: '~/.claude' },
    ])
  })

  it('discovers the loopback API process for the factory directory', () => {
    const found = findApiProcessFromPsOutput(
      '100 node /opt/ductum/dist/api/index.js --host 127.0.0.1 --port 4199 --db /Users/a/ductum/factory/ductum.db --dispatch',
      '/Users/a/ductum/factory',
    )

    expect(found).toMatchObject({ apiUrl: 'http://127.0.0.1:4199', port: 4199 })
  })

  it('selects approval and merged status records from CLI JSON payloads', () => {
    expect(selectFirstAwaitingApprovalRun([
      { derivedStage: 'implement', spec: { name: 'other' }, run: { id: 'r0' } },
      { derivedStage: 'awaiting_approval', spec: { name: 'hello-readme' }, run: { id: 'r1' } },
    ])?.run.id).toBe('r1')

    expect(selectMergedRunStatus({
      run: { stage: 'done', commitSha: 'def5678', branch: 'main', agentId: 'a1' },
      record: { agent: { name: 'claude-builder' } },
    })).toEqual({ mergedCommitSha: 'def5678', mergedBranch: 'main', agentName: 'claude-builder' })
    expect(selectMergedRunStatus({
      kind: 'status.attempt',
      data: {
        run: { stage: 'done', commitSha: 'abc1234', branch: 'feature/demo', agentId: 'a2' },
        record: { agent: { name: 'codex-builder' } },
      },
    })).toEqual({ mergedCommitSha: 'abc1234', mergedBranch: 'feature/demo', agentName: 'codex-builder' })
  })

  it('emits D135-style structured error envelopes', () => {
    expect(errorEnvelope('exit_demo_budget_exceeded', 'too slow', { totalSeconds: 700 })).toMatchObject({
      schemaVersion: 1,
      kind: 'error',
      data: {
        code: 'exit_demo_budget_exceeded',
        recoverable: false,
        context: { totalSeconds: 700 },
      },
    })
  })
})
