import { describe, expect, it } from 'vitest'

import { safeRepairValue } from '../index.js'

describe('repair redaction', () => {
  it('keeps operator paths visible while redacting secret values', () => {
    expect(safeRepairValue('projects.ductum.repositories.ductum.localPath', '/Users/acartagena/project/ductum'))
      .toBe('/Users/acartagena/project/ductum')
    expect(safeRepairValue('workflows.coding.path', 'workflows/coding-guard-template.yaml'))
      .toBe('workflows/coding-guard-template.yaml')
    expect(safeRepairValue('providers.anthropic.auth', 'missing')).toBe('missing')
    expect(safeRepairValue('providers.anthropic.auth', 'unknown')).toBe('unknown')
    expect(safeRepairValue('providers.anthropic.auth', 'configured')).toBe('configured')
    expect(safeRepairValue('providers.anthropic.auth', 'present')).toBe('present')
    expect(safeRepairValue('providers.anthropic.auth', 'sk-ant-api03-supersecret-token')).toBe('[redacted]')
    expect(safeRepairValue('host.provider.status', 'ghp_supersecretgithubtoken123456789')).toBe('[redacted]')
  })
})
