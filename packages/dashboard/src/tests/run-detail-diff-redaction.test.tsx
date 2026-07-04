import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { RunDetail } from '@/pages/RunDetail'
import { mockFetch, renderWithProviders } from './test-utils'

const BASE_PROJECT = { id: 'p1', factoryId: 'f1', name: 'ductum', repos: [], config: { mergeMode: 'squash', workflowPath: '' }, createdAt: '', updatedAt: '' }
const BASE_SPEC = { id: 's1', projectId: 'p1', name: 'impl-005', status: 'implementing', document: '', createdAt: '', updatedAt: '' }
const BASE_TASK = { id: 't1', specId: 's1', name: 'P2-REDACT', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'active', verification: [], createdAt: '', updatedAt: '' }

const SECRET_DIFF = {
  diff: 'diff --git a/.env b/.env\nindex 1111..2222 100644\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-OPENAI_API_KEY=sk-oldsecret123\n+OPENAI_API_KEY=sk-supersecret456\n',
  files: [{ path: '.env', insertions: 1, deletions: 1, status: 'text' as const }],
  totals: { files: 1, insertions: 1, deletions: 1 },
  base: 'main',
  truncated: false,
}

function attemptForRun(run: Record<string, unknown>) {
  return {
    ...run,
    recordType: 'Attempt',
    name: run.id,
    status: run.terminalState === 'failed' ? 'failed' : 'running',
    parentAttemptId: run.parentRunId,
    snapshot: { completeness: 'full', legacy: false, runtime: {}, missingFields: [] },
  }
}

function renderRunDetailWithSecretDiff() {
  const run = {
    id: 'run_abc123',
    taskId: 't1',
    agentId: 'a1',
    parentRunId: null,
    sessionId: 'sess_1',
    branch: 'feat/test',
    commitSha: 'abc1234',
    prNumber: null,
    prUrl: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: 'exit code 1',
    recoverable: true,
    terminalState: 'failed',
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    worktreePaths: ['/tmp/worktree'],
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    stage: 'implement',
  }
  const responses: Record<string, unknown> = {
    '/api/resolve/ductum/impl-005/P2-REDACT/run_ab': { project: BASE_PROJECT, spec: BASE_SPEC, task: BASE_TASK, run },
    '/api/attempts/run_abc123': attemptForRun(run),
    '/api/specs/s1/tasks': [BASE_TASK],
    '/api/tasks/t1/runs': [run],
    '/api/runs/run_abc123/evidence': [],
    '/api/runs/run_abc123/history': [],
    '/api/runs/run_abc123/gate-evaluations': [],
    '/api/runs/run_abc123/updates': [],
    '/api/runs/run_abc123/activity': [],
    '/api/decisions': [],
    '/api/agents': [{ id: 'a1', name: 'Mimi', model: 'claude-opus-4-6', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
    '/api/factory': null,
    '/api/runs/run_abc123/diff': SECRET_DIFF,
  }
  const { mock, restore } = mockFetch(responses)
  const result = renderWithProviders(
    <Routes>
      <Route path="/:project/:spec/:task" element={<div>Task route</div>} />
      <Route path="/:project/:spec/:task/:runId" element={<RunDetail />} />
    </Routes>,
    { route: '/ductum/impl-005/P2-REDACT/run_ab' },
  )
  return { ...result, mock, restore }
}

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('RunDetail diff redaction (P2 security hardening)', () => {
  it('does not render unredacted secret-shaped values from the worktree diff', async () => {
    // Defense-in-depth: the API already redacts diff text via publicOutput.
    // The dashboard must also redact, so a leaked raw diff at any layer
    // cannot surface a real credential in the rendered RunDetail page.
    const { restore } = renderRunDetailWithSecretDiff()
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('.env').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('sk-oldsecret123')
    expect(document.body.textContent ?? '').not.toContain('sk-supersecret456')
    expect(document.body.textContent ?? '').toContain('[hidden]')
  })
})
