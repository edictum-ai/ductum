import { describe, expect, it } from 'vitest'

import { OPERATOR_ACTION_MANIFEST } from '@/lib/operator-action-manifest'

describe('operator action manifest', () => {
  it('covers shipped mutating run actions across API, CLI, and UI controls', () => {
    expect(OPERATOR_ACTION_MANIFEST.map((action) => action.id)).toEqual(['approve', 'reject', 'retry', 'cancel'])

    for (const action of OPERATOR_ACTION_MANIFEST) {
      expect(action.apiEndpoint).toMatch(/^POST \/api\/runs\/:id\//)
      expect(action.cliCommand).toContain('ductum ')
      expect(action.cliCommand).toContain('<attemptId>')
      expect(action.uiControl).toMatch(/^RunControls\./)
      expect(action.requiresReason).toBe(true)
    }
  })
})
