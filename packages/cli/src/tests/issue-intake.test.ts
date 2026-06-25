import { describe, expect, it, vi } from 'vitest'

import { createMockApi, readyTask, runCommand, spec } from './helpers.js'

describe('issue intake command', () => {
  it('imports a structured GitHub issue into Ductum', async () => {
    const api = createMockApi({
      intakeGitHubIssue: vi.fn().mockResolvedValue({
        recordType: 'GitHubIssueIntake',
        import: {
          disposition: 'created',
          mode: 'issue-form',
          promptDigest: null,
          reviewPrompt: null,
        },
        issue: {
          url: 'https://github.com/edictum-ai/ductum/issues/12',
          title: 'core: imported issue',
          number: 12,
          labels: ['needs-triage'],
          repository: 'edictum-ai/ductum',
        },
        spec: { ...spec, name: 'core: imported issue' },
        task: {
          ...readyTask,
          name: 'core: imported issue',
          source: {
            kind: 'github-issue',
            parsed: {
              workType: 'feature',
              priority: 'P1 - blocks unattended/prod readiness',
              area: 'core',
            },
          },
        },
      }),
    })

    const result = await runCommand(['issue', 'intake', 'ductum', '12'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('issue: edictum-ai/ductum#12')
    expect(result.text).toContain('issueUrl: https://github.com/edictum-ai/ductum/issues/12')
    expect(result.text).toContain('title: core: imported issue')
    expect(result.text).toContain('labels: needs-triage')
    expect(result.text).toContain('importDisposition: created')
    expect(result.text).toContain('importMode: issue-form')
    expect(result.text).toContain('workType: feature')
    expect(result.text).toContain('priority: P1 - blocks unattended/prod readiness')
    expect(result.text).toContain('area: core')
    expect(result.text).toContain('verificationCommands: 1')
    expect(api.intakeGitHubIssue).toHaveBeenCalledWith({
      projectId: 'project-1',
      repositoryId: undefined,
      issueRef: '12',
    })
  })

  it('shows prompt import routing and digest for explicit GitHub prompt sections', async () => {
    const api = createMockApi({
      intakeGitHubIssue: vi.fn().mockResolvedValue({
        recordType: 'GitHubIssueIntake',
        import: {
          disposition: 'unchanged',
          mode: 'prompt-sections',
          promptDigest: 'abc123digest',
          reviewPrompt: {
            routedToTask: true,
            source: 'issue comment (https://github.com/edictum-ai/ductum/issues/48#issuecomment-1)',
          },
        },
        issue: {
          url: 'https://github.com/edictum-ai/ductum/issues/48',
          title: 'factory: import prompts from issue',
          number: 48,
          labels: ['P1'],
          repository: 'edictum-ai/ductum',
        },
        spec: { ...spec, name: 'factory: import prompts from issue' },
        task: {
          ...readyTask,
          name: 'factory: import prompts from issue',
          verification: [],
          source: {
            kind: 'github-issue',
            promptImport: {
              mode: 'prompt-sections',
            },
          },
        },
      }),
    })

    const result = await runCommand([
      'issue',
      'intake',
      'ductum',
      '48',
      '--prompt-comment-urls',
      'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
    ], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('importDisposition: unchanged')
    expect(result.text).toContain('importMode: prompt-sections')
    expect(result.text).toContain('promptDigest: abc123digest')
    expect(result.text).toContain('reviewPrompt: routed-to-review-task via issue comment')
    expect(result.text).toContain('verificationCommands: 0')
    expect(api.intakeGitHubIssue).toHaveBeenCalledWith({
      projectId: 'project-1',
      repositoryId: undefined,
      issueRef: '48',
      promptCommentUrls: ['https://github.com/edictum-ai/ductum/issues/48#issuecomment-1'],
    })
  })

  it('requires a named repository when the option is passed', async () => {
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([]),
    })

    const result = await runCommand(['issue', 'intake', 'ductum', '12', '--repository', 'missing'], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Repository not found in project ductum: missing')
    expect(api.intakeGitHubIssue).not.toHaveBeenCalled()
  })
})
