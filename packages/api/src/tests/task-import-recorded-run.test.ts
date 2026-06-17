import { describe, expect, it, vi } from 'vitest'

import { recordImportedTaskRun } from '../lib/record-imported-task-run.js'
import { createFixture, requestJson, seedBase } from './helpers.js'

describe('record imported task run', () => {
  it('creates a recorded done run with bulk-import provenance and synthetic author agent', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/recorded-run`, {
        method: 'POST',
        body: {
          author: 'Arnold Cartagena',
          branch: 'main',
          commitSha: 'abc123',
          sourcePath: 'specs/current/workflow-profile-runtime',
          taskFilePath: 'specs/current/workflow-profile-runtime/P1-WORKFLOW-PROFILE-RUNTIME.md',
          subject: 'feat: wire workflow profiles into runtime',
          importedAt: '2026-05-01T12:00:00.000Z',
          linkedCommits: [{
            sha: 'abc123',
            author: 'Arnold Cartagena',
            subject: 'feat: wire workflow profiles into runtime',
            branch: 'main',
            taskName: task.name,
            path: 'specs/current/workflow-profile-runtime/P1-WORKFLOW-PROFILE-RUNTIME.md',
          }],
        },
      })

      expect(response.response.status).toBe(201)
      expect(response.json).toMatchObject({
        alreadyRecorded: false,
        task: { id: task.id, status: 'done' },
        run: {
          taskId: task.id,
          stage: 'done',
          terminalState: null,
          sessionId: null,
          branch: 'main',
          commitSha: 'abc123',
        },
        agent: {
          id: 'Arnold Cartagena',
          name: 'Arnold Cartagena',
        },
        evidence: {
          type: 'custom',
          payload: {
            kind: 'bulk-import-shipped-spec',
            sourcePath: 'specs/current/workflow-profile-runtime',
            commitSha: 'abc123',
            branch: 'main',
          },
        },
      })

      const integrity = await requestJson(fixture.app, '/api/factory/execution-integrity')
      expect(integrity.response.status).toBe(200)
      expect((integrity.json as { runs: Array<{ executionMode: string; executionIssues: unknown[] }> }).runs[0]).toMatchObject({
        executionMode: 'recorded',
        executionIssues: [],
      })
    } finally {
      fixture.close()
    }
  })

  it('is idempotent and reuses the existing imported run', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)
      const body = {
        author: 'Arnold Cartagena',
        branch: 'main',
        commitSha: 'abc123',
        sourcePath: 'specs/current/workflow-profile-runtime',
      }

      const first = await requestJson(fixture.app, `/api/tasks/${task.id}/recorded-run`, {
        method: 'POST',
        body,
      })
      const second = await requestJson(fixture.app, `/api/tasks/${task.id}/recorded-run`, {
        method: 'POST',
        body,
      })

      expect(first.response.status).toBe(201)
      expect(second.response.status).toBe(200)
      expect(second.json).toMatchObject({ alreadyRecorded: true })
      expect(fixture.repos.runs.list(task.id)).toHaveLength(1)
    } finally {
      fixture.close()
    }
  })

  it('rolls back the synthetic author agent when run recording fails', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)
      vi.spyOn(fixture.context.repos.evidence, 'create').mockImplementation(() => {
        throw new Error('boom')
      })
      expect(() => recordImportedTaskRun(fixture.context, task.id, {
        author: 'Arnold Cartagena',
        branch: 'main',
        commitSha: 'abc123',
        sourcePath: 'specs/current/workflow-profile-runtime',
      })).toThrow('boom')
      expect(fixture.repos.agents.get('Arnold Cartagena' as never)).toBeNull()
      expect(fixture.repos.runs.list(task.id)).toHaveLength(0)
    } finally {
      fixture.close()
    }
  })
})
