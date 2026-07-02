import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { AuditLog } from '@/pages/AuditLog'
import { RunDetail } from '@/pages/RunDetail'
import { callsOf, mockFetch, renderWithProviders } from './test-utils'

const PROJECT = { id: 'p1', factoryId: 'f1', name: 'ductum', repos: [], config: { mergeMode: 'squash', workflowPath: '' }, createdAt: '', updatedAt: '' }
const SPEC = { id: 's1', projectId: 'p1', name: 'impl-005', status: 'active', document: '', createdAt: '', updatedAt: '' }
const TASK = { id: 't1', specId: 's1', name: 'P1-TRIAGE', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'active', verification: [], createdAt: '', updatedAt: '' }
const RUN = {
  id: 'run_abc123',
  taskId: TASK.id,
  agentId: 'a1',
  parentRunId: null,
  sessionId: 'sess_1',
  stage: 'implement',
  branch: 'fix/evidence-bundle',
  commitSha: null,
  prNumber: null,
  prUrl: null,
  ciStatus: null,
  reviewStatus: null,
  failReason: null,
  recoverable: true,
  terminalState: null,
  resetCount: 0,
  completedStages: ['understand'],
  blockedReason: null,
  pendingApproval: false,
  tokensIn: 100,
  tokensOut: 10,
  costUsd: 0.01,
  lastHeartbeat: new Date().toISOString(),
  heartbeatTimeoutSeconds: 120,
  completionSummary: null,
  worktreePaths: null,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
}
const BUNDLE = {
  schemaVersion: 1,
  kind: 'ductum.audit_bundle.v1',
  scope: { type: 'run', runId: RUN.id, taskId: TASK.id, specId: SPEC.id, projectId: PROJECT.id },
  generatedAt: '2026-07-02T04:00:00.000Z',
  manifest: { algorithm: 'sha256', contextHash: 'ctx', manifestHash: 'manifest', recordHashes: [], excludes: ['generatedAt'] },
  records: { decisions: [], evidence: [] },
}

let fetchHelper: ReturnType<typeof mockFetch>
let originalCreateObjectURL: typeof URL.createObjectURL | undefined
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined

beforeEach(() => {
  originalCreateObjectURL = URL.createObjectURL
  originalRevokeObjectURL = URL.revokeObjectURL
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:bundle') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  fetchHelper?.restore()
  vi.restoreAllMocks()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL })
})

describe('evidence bundle downloads', () => {
  it('downloads a hash-manifest bundle from a run-scoped audit view', async () => {
    fetchHelper = mockFetch({
      '/api/audit-log': { items: [], nextCursor: null },
      '/api/audit-bundle': BUNDLE,
    })

    renderWithProviders(
      <Routes>
        <Route path="/audit" element={<AuditLog />} />
      </Routes>,
      { route: `/audit?runId=${RUN.id}` },
    )

    expect(await screen.findByText(/Run scope active/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download evidence bundle' }))

    await waitFor(() => {
      expect(String(callsOf(fetchHelper, 'GET', '/api/audit-bundle').at(-1)?.[0]))
        .toContain(`runId=${RUN.id}`)
    })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('exposes the evidence bundle export on run detail', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/ductum/impl-005/P1-TRIAGE/run_ab': { project: PROJECT, spec: SPEC, task: TASK, run: RUN },
      '/api/attempts/run_abc123': { ...RUN, recordType: 'Attempt', name: RUN.id, status: 'running', parentAttemptId: null, snapshot: { completeness: 'full', legacy: false, runtime: {}, missingFields: [] } },
      '/api/specs/s1/tasks': [TASK],
      '/api/tasks/t1/runs': [RUN],
      '/api/runs/run_abc123/evidence': [],
      '/api/runs/run_abc123/history': [],
      '/api/runs/run_abc123/gate-evaluations': [],
      '/api/runs/run_abc123/updates': [],
      '/api/runs/run_abc123/activity': [],
      '/api/runs/run_abc123/secret-access-history': [],
      '/api/decisions': [],
      '/api/agents': [{ id: 'a1', name: 'glm', model: 'glm-5.2', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
      '/api/factory': null,
      '/api/audit-bundle': BUNDLE,
    })

    renderWithProviders(
      <Routes>
        <Route path="/:project/:spec/:task/:runId" element={<RunDetail />} />
      </Routes>,
      { route: '/ductum/impl-005/P1-TRIAGE/run_ab' },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Evidence bundle' }))

    await waitFor(() => {
      expect(String(callsOf(fetchHelper, 'GET', '/api/audit-bundle').at(-1)?.[0]))
        .toContain(`runId=${RUN.id}`)
    })
  })
})
