import { describe, expect, it, vi } from 'vitest'

import { createMockApi, readyTask, runCommand, spec } from './helpers.js'

describe('issue intake command', () => {
  it('imports a structured GitHub issue into Ductum', async () => {
    const api = createMockApi({
      intakeGitHubIssue: vi.fn().mockResolvedValue({
        recordType: 'GitHubIssueIntake',
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
