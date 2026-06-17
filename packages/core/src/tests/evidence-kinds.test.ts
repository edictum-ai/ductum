import { describe, expect, it } from 'vitest'

import { EVIDENCE_KINDS, getEvidenceKind, validateEvidencePayload } from '../evidence-kinds.js'

describe('typed evidence registry', () => {
  it('registers the initial D135 evidence kinds', () => {
    expect(Object.keys(EVIDENCE_KINDS).sort()).toEqual([
      'exit_demo.run',
      'harness.failure',
      'operator.cancel',
      'operator.note',
      'worktree.snapshot',
    ])
  })

  it('validates worktree snapshot payloads', () => {
    const payload = {
      kind: 'worktree.snapshot',
      branch: 'feat/reliability',
      commitSha: 'abc123',
      diffStat: { filesChanged: 2, insertions: 10, deletions: 1 },
      verifyOutput: { command: 'pnpm test', exitCode: 0, tail: 'pass' },
      timestamp: '2026-05-03T12:00:00.000Z',
    }
    expect(getEvidenceKind(payload)).toBe('worktree.snapshot')
    expect(validateEvidencePayload(payload)).toBe(true)
  })

  it('rejects malformed typed payloads', () => {
    expect(validateEvidencePayload({ kind: 'operator.cancel', reason: 'stop' })).toBe(false)
    expect(validateEvidencePayload({ kind: 'operator.note', note: 'verified by operator' })).toBe(true)
  })

  it('validates exit demo run payloads', () => {
    const payload = {
      kind: 'exit_demo.run',
      schemaVersion: 1,
      data: {
        demoName: 'bootstrap-redesign-p5',
        machineSignature: { osHash: 'os123', osPlatform: 'darwin', hostnameHash: 'host123' },
        timeline: [
          { phase: 'install_g', t: 0 },
          { phase: 'init_anthropic_auth', t: 1200 },
          { phase: 'serve_ready', t: 2200 },
          { phase: 'spec_imported', t: 3000 },
          { phase: 'run_awaiting_approval', t: 120000 },
          { phase: 'approve_clicked', t: 130000 },
          { phase: 'merged', t: 170000 },
        ],
        totalSeconds: 170,
        mergedCommitSha: 'abc123',
        mergedBranch: 'main',
        agentName: 'claude-builder',
        promptText: 'Append the line `Bootstrap proof: hello from Ductum.` to `README.md`.',
        operatorActions: ['browser_auth', 'approve_click'],
      },
    }
    expect(getEvidenceKind(payload)).toBe('exit_demo.run')
    expect(validateEvidencePayload(payload)).toBe(true)
    expect(validateEvidencePayload({
      ...payload,
      data: { ...payload.data, operatorActions: ['browser_auth', 'approve_click', 'manual_retry'] },
    })).toBe(false)
    expect(validateEvidencePayload({
      ...payload,
      data: {
        ...payload.data,
        timeline: [
          { phase: 'install_g', t: 0 },
          { phase: 'serve_ready', t: 2200 },
          { phase: 'init_anthropic_auth', t: 1200 },
          { phase: 'spec_imported', t: 3000 },
          { phase: 'run_awaiting_approval', t: 120000 },
          { phase: 'approve_clicked', t: 130000 },
          { phase: 'merged', t: 170000 },
        ],
      },
    })).toBe(false)
  })
})
