import { describe, expect, it, vi } from 'vitest'

import { createMockApi, readyTask, runCommand } from './helpers.js'

describe('task adopt-pr command', () => {
  it('adopts an operator-created PR into the approval path', async () => {
    const adoptOperatorPullRequest = vi.fn().mockResolvedValue({
      task: { ...readyTask, status: 'active' },
      run: {
        id: 'run-adopted',
        taskId: readyTask.id,
        stage: 'ship',
        pendingApproval: true,
      },
      agent: { id: 'operator', name: 'operator' },
      pr: {
        number: 42,
        url: 'https://github.com/edictum-ai/ductum/pull/42',
        headBranch: 'fix/operator-pr',
        headSha: 'abc123def456',
        baseBranch: 'main',
      },
      evidence: [],
      alreadyAdopted: false,
    })
    const api = createMockApi({ adoptOperatorPullRequest })

    const result = await runCommand([
      'task',
      'adopt-pr',
      readyTask.id,
      '42',
      '--author',
      'operator',
      '--reason',
      'salvaged verified branch',
    ], api)

    expect(result.code).toBe(0)
    expect(adoptOperatorPullRequest).toHaveBeenCalledWith(readyTask.id, {
      pr: '42',
      author: 'operator',
      reason: 'salvaged verified branch',
    })
    expect(result.text).toContain('run: run-adopted')
    expect(result.text).toContain('pr: #42')
    expect(result.text).toContain('next: ductum approve run-adopted')
  })
})
