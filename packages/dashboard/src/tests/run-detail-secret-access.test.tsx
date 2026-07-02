import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { RunDetail } from '@/pages/RunDetail'
import { secretAccessEventFixture } from './settings-fixtures'
import { callsOf, mockFetch, renderWithProviders } from './test-utils'

const project = {
  id: 'p1',
  factoryId: 'f1',
  name: 'ductum',
  repos: [],
  config: { mergeMode: 'squash', workflowPath: '' },
  createdAt: '',
  updatedAt: '',
}
const spec = { id: 's1', projectId: 'p1', name: 'impl-005', status: 'implementing', document: '', createdAt: '', updatedAt: '' }
const task = {
  id: 't1',
  specId: 's1',
  name: 'P1-TRIAGE',
  prompt: '',
  repos: [],
  assignedAgentId: null,
  requiredRole: null,
  complexity: null,
  status: 'active',
  verification: [],
  createdAt: '',
  updatedAt: '',
}
const run = {
  id: 'run_abc123',
  taskId: 't1',
  agentId: 'a1',
  parentRunId: null,
  stage: 'implement',
  terminalState: null,
  sessionId: 'sess_1',
  branch: 'feat/test',
  commitSha: 'abc1234',
  prNumber: null,
  prUrl: null,
  ciStatus: null,
  reviewStatus: null,
  failReason: null,
  recoverable: true,
  resetCount: 0,
  completedStages: [],
  blockedReason: null,
  pendingApproval: false,
  tokensIn: 100000,
  tokensOut: 15000,
  costUsd: 1.25,
  lastHeartbeat: new Date().toISOString(),
  heartbeatTimeoutSeconds: 120,
  completionSummary: null,
  worktreePaths: null,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
}

let cleanup: (() => void) | null = null

afterEach(() => cleanup?.())

describe('RunDetail secret access history', () => {
  it('shows value-free secret access history for the attempt', async () => {
    const fetchHelper = mockFetch({
      '/api/resolve/ductum/impl-005/P1-TRIAGE/run_ab': { project, spec, task, run },
      '/api/attempts/run_abc123': {
        ...run,
        recordType: 'Attempt',
        name: run.id,
        status: 'running',
        parentAttemptId: null,
        snapshot: { completeness: 'full', legacy: false, runtime: {}, missingFields: [] },
      },
      '/api/specs/s1/tasks': [task],
      '/api/tasks/t1/runs': [run],
      '/api/runs/run_abc123/evidence': [],
      '/api/runs/run_abc123/history': [],
      '/api/runs/run_abc123/gate-evaluations': [],
      '/api/runs/run_abc123/updates': [],
      '/api/runs/run_abc123/activity': [],
      '/api/runs/run_abc123/secret-access-history': [
        secretAccessEventFixture({
          secretRef: 'secret:sec_1',
          runId: 'run_abc123',
          agentId: 'agent_atlas',
          outcome: 'failure',
          errorMessage: 'failed with sk-ant-run-secret and ghp_abcdefghijklmnopqrstuvwxyz123456',
        }),
      ],
      '/api/decisions': [],
      '/api/agents': [{ id: 'a1', name: 'Mimi', model: 'claude-opus-4-6', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
      '/api/factory': null,
    })
    const { restore } = fetchHelper
    cleanup = restore

    renderWithProviders(
      <Routes><Route path="/:project/:spec/:task/:runId" element={<RunDetail />} /></Routes>,
      { route: '/ductum/impl-005/P1-TRIAGE/run_ab' },
    )

    await waitFor(() => {
      expect(screen.getByText('Secret access')).toBeInTheDocument()
      expect(screen.getByText('secret:sec_1')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'run run_ab' })).toHaveAttribute('href', '/runs/run_abc123')
    })
    expect(callsOf(fetchHelper, 'GET', '/api/factory/secrets')).toHaveLength(0)
    expect(document.body.textContent ?? '').not.toContain('anthropic-api-key')
    expect(document.body.textContent ?? '').not.toContain('plain-secret-value')
    expect(document.body.textContent ?? '').not.toContain('sk-ant-run-secret')
    expect(document.body.textContent ?? '').not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456')
    expect(document.body.textContent ?? '').not.toContain('ciphertext')
    expect(document.body.textContent ?? '').not.toContain('encryptedPayload')
  })
})
