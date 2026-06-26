import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { legacyIssueBody, stubIssueFetch } from './github-issue-intake.helpers.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

describe('GitHub legacy issue intake route', () => {
  afterEachFixture()

  it('imports legacy migrated markdown issues when no structured Ductum form is present', async () => {
    fixture = await createLegacyFixture()
    const projectId = fixture.repos.projects.getByName('ductum')?.id
    vi.stubGlobal('fetch', stubIssueFetch({
      number: 32,
      title: 'fix(intake): support legacy migrated GitHub issues',
      body: legacyIssueBody(),
      labels: [{ name: 'priority:p3' }],
      comments: [],
    }))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: { projectId, issueRef: '32' },
    })

    expect(result.response.status).toBe(201)
    expect(result.json).toMatchObject({
      recordType: 'GitHubIssueIntake',
      import: { disposition: 'created', mode: 'issue-form', promptDigest: null, reviewPrompt: null },
      issue: {
        url: 'https://github.com/edictum-ai/ductum/issues/32',
        number: 32,
        repository: 'edictum-ai/ductum',
      },
      spec: {
        source: {
          parsed: {
            workType: 'Bug fix',
            priority: 'priority:p3',
            area: 'intake',
            verificationCommands: ['pnpm build', 'pnpm test', 'git diff --check', 'node scripts/check-file-size.mjs'],
          },
        },
      },
      task: {
        verification: ['pnpm build', 'pnpm test', 'git diff --check', 'node scripts/check-file-size.mjs'],
      },
    })
    const prompt = (result.json as { task: { prompt: string } }).task.prompt
    expect(prompt).toContain('## Objective')
    expect(prompt).toContain('Import legacy migrated issues directly from GitHub')
    expect(prompt).toContain('## Requirements')
    expect(prompt).toContain('Address the documented problem')
    expect(prompt).toContain('## Acceptance criteria')
    expect(prompt).toContain('`ductum issue intake ductum 32` succeeds')
  })

  it('keeps strict form validation when a malformed Ductum issue form also contains legacy headings', async () => {
    fixture = await createLegacyFixture()
    const projectId = fixture.repos.projects.getByName('ductum')?.id
    vi.stubGlobal('fetch', stubIssueFetch({
      body: [legacyIssueBody(), '', '### Priority', 'P1'].join('\n'),
      comments: [],
    }))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: { projectId, issueRef: '12' },
    })

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('GitHub issue form is missing required field: Work type')
  })

  it('imports legacy migrated issues that use Expected fix instead of Desired outcome', async () => {
    fixture = await createLegacyFixture()
    const projectId = fixture.repos.projects.getByName('ductum')?.id
    vi.stubGlobal('fetch', stubIssueFetch({
      number: 11,
      title: 'migration: triage old issues with proof',
      body: legacyIssueBody({
        expectedFix: 'Migrate still-open issues into `edictum-ai/ductum` or close legacy issues with proof comments.',
        acceptance: [
          '- Legacy issue list is empty or intentionally cross-linked to new issues.',
          '- Done issues are closed only with proof.',
        ],
      }),
      labels: [{ name: 'priority:medium' }],
      comments: [],
    }))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: { projectId, issueRef: '11' },
    })

    expect(result.response.status).toBe(201)
    const prompt = (result.json as { task: { prompt: string } }).task.prompt
    expect(prompt).toContain('Migrate still-open issues into `edictum-ai/ductum`')
    expect(prompt).toContain('Legacy issue list is empty or intentionally cross-linked')
    expect(result.json).toMatchObject({
      spec: {
        source: {
          parsed: {
            area: 'migration',
            priority: 'priority:medium',
          },
        },
      },
    })
  })
})

async function createLegacyFixture(): Promise<TestFixture> {
  const testFixture = await createFixture()
  const { project } = seedBase(testFixture)
  vi.stubEnv('DUCTUM_GITHUB_DEV_READ_MODE', 'pat')
  vi.stubEnv('DUCTUM_GITHUB_DEV_TOKEN', 'dev-read-token')
  testFixture.repos.repositories.create({
    id: createId<'RepositoryId'>() as never,
    projectId: project.id,
    name: 'ductum',
    spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
  })
  return testFixture
}

function afterEachFixture(): void {
  afterEach(() => {
    vi.restoreAllMocks()
    fixture?.close()
    fixture = undefined
  })
}
