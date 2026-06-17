import { describe, expect, it } from 'vitest'

import { normalizeCodexModel } from '../codex-model.js'

describe('normalizeCodexModel', () => {
  it('passes configured codex model ids through to the CLI form', () => {
    expect(normalizeCodexModel('gpt-5.4')).toBe('gpt-5.4')
    expect(normalizeCodexModel('openai/gpt-5.4')).toBe('gpt-5.4')
    expect(normalizeCodexModel('')).toBeUndefined()
  })
})
