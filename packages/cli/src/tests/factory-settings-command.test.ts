import { describe, expect, it } from 'vitest'

import { createMockApi, factorySettings, runCommand } from './helpers.js'

describe('factory settings command', () => {
  it('shows concrete Factory Settings sections', async () => {
    const api = createMockApi()
    const result = await runCommand(['factory', 'settings'], api)

    expect(result.code).toBe(0)
    expect(api.getFactorySettings).toHaveBeenCalled()
    expect(result.text).toContain('Providers')
    expect(result.text).toContain('Models')
    expect(result.text).toContain('Harnesses')
    expect(result.text).toContain('Workflows')
    expect(result.text).toContain('Agents')
    expect(result.text).toContain('Sandboxes')
    expect(result.text).toContain('Notifications')
    expect(result.text.toLowerCase()).not.toContain('resource')
  })

  it('preserves model identity separate from provider model ID in JSON output', async () => {
    const result = await runCommand(['--json', 'factory', 'settings'], createMockApi())
    const data = JSON.parse(result.text) as typeof factorySettings

    expect(data.models[0]).toMatchObject({
      modelId: 'gpt-54',
      providerModelId: 'gpt-5.4',
    })
  })
})
