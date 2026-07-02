import { createHash } from 'node:crypto'
import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - audit bundle', () => {
  it('exports a run-scoped evidence bundle with stable hashes and sanitized records', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-02T04:00:00.000Z') })
    const { spec, task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'fix/evidence-bundle',
      commitSha: 'abc123',
      prNumber: 235,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/235',
      worktreePaths: ['/Users/acartagena/project/ductum'],
      ciStatus: 'pass',
      reviewStatus: 'pass',
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-07-02T04:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.decisions.create({
      id: createId<'DecisionId'>(),
      specId: spec.id,
      taskId: task.id,
      runId: run.id,
      decision: 'Approve hash bundle',
      context: 'Contains sk-auditsecret123 and /Users/acartagena/project/ductum/packages/api/src/routes/audit-bundle.ts',
      alternatives: ['plain transcript'],
      decidedBy: 'operator',
      supersedesId: null,
    })
    fixture.repos.decisions.create({
      id: createId<'DecisionId'>(),
      specId: spec.id,
      taskId: null,
      runId: null,
      decision: 'Spec-level audit requirement',
      context: 'Bundle exports are required for this issue.',
      alternatives: null,
      decidedBy: 'security',
      supersedesId: null,
    })
    fixture.repos.decisions.create({
      id: createId<'DecisionId'>(),
      specId: null,
      taskId: task.id,
      runId: null,
      decision: 'Task-level bundle route',
      context: 'Use a run-scoped API route first.',
      alternatives: null,
      decidedBy: 'developer',
      supersedesId: null,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        file: '/Users/acartagena/project/ductum/.env.local',
        nested: {
          token: 'sk-auditsecret123',
          note: 'safe note',
          downloadedKey: '/Users/alice/Downloads/key.pem',
          tempFile: '/private/var/folders/gg/tmp-output.txt',
          cwd: 'cwd:/Users/alice/src/repo',
          labeledPath: 'path:/private/var/folders/x',
        },
      },
    })

    const first = await requestJson(fixture.app, `/api/audit-bundle?runId=${run.id}`)
    const second = await requestJson(fixture.app, `/api/runs/${run.id}/audit-bundle`)

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)
    const bundle = first.json as {
      scope: { runId: string; taskId: string; specId: string; projectId: string }
      context: { task: { name: string }; spec: { id: string } }
      records: { decisions: Array<{ contentHash: string; context: string; specId: string | null; taskId: string | null; runId: string | null }>; evidence: Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string; contentHash: string }> }
      manifest: { manifestHash: string; recordHashes: Array<{ section: string; id: string; sha256: string }>; excludes: string[] }
    }
    expect(bundle.scope).toMatchObject({ runId: run.id, taskId: task.id, specId: spec.id })
    expect(bundle.context.task.name).toBe(task.name)
    expect(bundle.records.decisions).toHaveLength(3)
    expect(bundle.records.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: run.id }),
      expect.objectContaining({ taskId: task.id }),
      expect.objectContaining({ specId: spec.id }),
    ]))
    expect(bundle.records.evidence).toHaveLength(1)
    expect(bundle.manifest.recordHashes).toHaveLength(4)
    expect(bundle.manifest.recordHashes.map((item) => item.sha256)).toEqual([
      ...bundle.records.decisions.map((item) => item.contentHash),
      bundle.records.evidence[0]!.contentHash,
    ])
    expect((second.json as { manifest: { manifestHash: string } }).manifest.manifestHash)
      .toBe(bundle.manifest.manifestHash)
    expect(bundle.manifest.excludes).toEqual(['generatedAt'])
    expect(JSON.stringify(bundle)).not.toContain('sk-auditsecret123')
    expect(JSON.stringify(bundle)).not.toContain('/Users/acartagena/project')
    const evidence = bundle.records.evidence[0]!
    expect(evidence.payload.file).toBe('ductum/.env.local')
    expect(JSON.stringify(evidence.payload)).not.toContain('/Users/alice')
    expect(JSON.stringify(evidence.payload)).not.toContain('/private/var')
    expect(JSON.stringify(evidence.payload)).toContain('host-path/Downloads/key.pem')
    expect(JSON.stringify(evidence.payload)).toContain('cwd:host-path/src/repo')
    expect(JSON.stringify(evidence.payload)).toContain('path:host-path/var/folders/x')
    const exportedEvidenceRecord = {
      id: evidence.id,
      type: evidence.type,
      payload: evidence.payload,
      createdAt: evidence.createdAt,
    }
    expect(evidence.contentHash).toBe(sha256(exportedEvidenceRecord))
    expect(evidence.contentHash).not.toBe(sha256({ ...exportedEvidenceRecord, createdAt: '2026-07-03T00:00:00.000Z' }))
  })

  it('returns clear errors for missing or unknown run scope', async () => {
    fixture = await createFixture()

    const missing = await requestJson(fixture.app, '/api/audit-bundle')
    const unknown = await requestJson(fixture.app, '/api/audit-bundle?runId=missing-run')

    expect(missing.response.status).toBe(400)
    expect(missing.json).toMatchObject({ error: 'runId is required' })
    expect(unknown.response.status).toBe(404)
    expect(unknown.json).toMatchObject({ error: 'Run not found: missing-run' })
  })
})

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex')
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value != null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(obj).sort().map((key) => [key, sortKeys(obj[key])]))
  }
  return value
}
