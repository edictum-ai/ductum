import { describe, expect, it, vi } from 'vitest'

import { createMockApi, runCommand, spec } from './helpers.js'

describe('spec approve command', () => {
  it('accepts spec ids that start with a dash after option parsing terminator', async () => {
    const specId = '-spec-bootstrap'
    const api = createMockApi({
      approveSpec: vi.fn().mockResolvedValue({ ...spec, id: specId, status: 'approved' as const }),
    })

    const result = await runCommand(['spec', 'approve', '--', specId], api)

    expect(result.code).toBe(0)
    expect(api.approveSpec).toHaveBeenCalledWith(specId)
    expect(result.text).toContain(`Approved spec ${specId}`)
  })
})
