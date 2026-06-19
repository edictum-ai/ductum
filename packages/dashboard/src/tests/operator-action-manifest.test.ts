import { describe, expect, it } from 'vitest'

import { DASHBOARD_OPERATOR_ACTIONS, OPERATOR_ACTION_MANIFEST } from '@/lib/operator-action-manifest'

describe('operator action manifest', () => {
  it('covers shipped mutating run actions and explicit parity gaps', () => {
    expect(OPERATOR_ACTION_MANIFEST.map((action) => action.id)).toEqual([
      'approve',
      'approveRebase',
      'reject',
      'retry',
      'cancel',
      'budgetExtend',
      'budgetDeny',
      'turnsExtend',
      'turnsDeny',
    ])

    for (const action of OPERATOR_ACTION_MANIFEST) {
      expect(action.apiEndpoint).toMatch(/^POST \/api\/runs\/:id\//)
      if (action.cliCommand != null) {
        expect(action.cliCommand).toContain('ductum ')
        expect(action.cliCommand).toContain('<attemptId>')
      }
    }

    expect(DASHBOARD_OPERATOR_ACTIONS.map((action) => action.id)).toEqual(['approve', 'reject', 'retry', 'cancel'])
    for (const action of DASHBOARD_OPERATOR_ACTIONS) {
      expect(action.dashboardControl).toMatch(/^RunControls\./)
      expect(action.reasonPolicy.dashboard).toBe('required')
      expect(action.cliCommand).not.toBeNull()
    }
    expect(operator('approve').reasonPolicy).toEqual({ api: 'optional', cli: 'optional', dashboard: 'required' })
    expect(operator('reject').reasonPolicy).toEqual({ api: 'required', cli: 'required', dashboard: 'required' })
    expect(operator('approveRebase').dashboardControl).toBeNull()
    expect(operator('approveRebase').parityNote).toMatch(/CLI\/API only/)
    expect(operator('budgetExtend').cliCommand).toBeNull()
    expect(operator('turnsDeny').reasonPolicy.api).toBe('required')
  })
})

function operator(id: string) {
  const action = OPERATOR_ACTION_MANIFEST.find((item) => item.id === id)
  if (action == null) throw new Error(`missing action ${id}`)
  return action
}
