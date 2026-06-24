import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fixture?.close()
  fixture = undefined
})

describe('GitHub issue intake route', () => {
  it('imports a structured GitHub issue form into a Spec and Task with source metadata', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      number: 12,
      html_url: 'https://github.com/edictum-ai/ductum/issues/12',
      title: 'core: imported issue',
      body: issueFormBody(),
      labels: [{ name: 'needs-triage' }, { name: 'P1' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: { projectId: project.id, issueRef: '12' },
    })

    expect(result.response.status).toBe(201)
    expect(result.json).toMatchObject({
      recordType: 'GitHubIssueIntake',
      issue: {
        url: 'https://github.com/edictum-ai/ductum/issues/12',
        number: 12,
        repository: 'edictum-ai/ductum',
      },
      spec: {
        name: 'core: imported issue',
        source: {
          kind: 'github-issue',
          issueNumber: 12,
          parsed: {
            objective: 'After this work, Ductum should import issue-form tasks.',
            verificationCommands: ['pnpm build', 'pnpm test'],
            suggestedBranch: 'feat/github-issue-intake-auth',
          },
        },
      },
      task: {
        name: 'core: imported issue',
        verification: ['pnpm build', 'pnpm test'],
        source: { kind: 'github-issue', issueNumber: 12 },
      },
    })
    expect((result.json as { task: { prompt: string } }).task.prompt).toContain('## Acceptance criteria')
  })

  it('rejects missing required issue-form fields', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      number: 12,
      html_url: 'https://github.com/edictum-ai/ductum/issues/12',
      title: 'core: imported issue',
      body: issueFormBody({ includeSafety: false }),
      labels: [{ name: 'needs-triage' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: { projectId: project.id, issueRef: '12' },
    })

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('GitHub issue form is missing required field: Safety and rollback notes')
  })
})

function issueFormBody(input: { includeSafety?: boolean } = {}) {
  return [
    '### Work type',
    'feature',
    '',
    '### Priority',
    'P1 - blocks unattended/prod readiness',
    '',
    '### Area',
    'core',
    '',
    '### Blockers',
    '- [x] Blocks unattended operation',
    '',
    '### Objective',
    'After this work, Ductum should import issue-form tasks.',
    '',
    '### Evidence and source refs',
    '- packages/api/src/routes/issues.ts',
    '- failing operator report',
    '',
    '### Requirements',
    '- Must preserve GitHub source metadata.',
    '- Must reject missing required fields.',
    '',
    '### Out of scope',
    '- Do not close the issue.',
    '',
    '### Acceptance criteria',
    '- [ ] Imported task carries source provenance.',
    '- [ ] Missing required fields fail loudly.',
    '',
    '### Verification commands',
    'pnpm build',
    'pnpm test',
    '',
    ...(input.includeSafety === false
      ? []
      : [
        '### Safety and rollback notes',
        '- No destructive commands.',
        '',
      ]),
    '### Suggested branch',
    'feat/github-issue-intake-auth',
    '',
    '### Ductum executor hints',
    'Suggested builder: codex',
  ].join('\n')
}
