import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// P3 removed ductum.yaml from normal operation. The Factory now lives in
// SQLite, created by `ductum init` alongside `.ductum/secrets.key`. These
// tests are reintroduction guards: the repo root must not ship a tracked
// config file that could become a second source of truth for Factory state.
describe('DB-only onboarding (no root config files)', () => {
  it('does not ship a root ductum.yaml', () => {
    expect(existsSync(new URL('../ductum.yaml', import.meta.url))).toBe(false)
  })

  it('does not ship a root ductum.example.yaml', () => {
    expect(existsSync(new URL('../ductum.example.yaml', import.meta.url))).toBe(false)
  })

  it('does not ship a root ductum.docker.yaml', () => {
    expect(existsSync(new URL('../ductum.docker.yaml', import.meta.url))).toBe(false)
  })

  it('docker compose does not mount a config file or require a host operator token', () => {
    const compose = parse(readFileSync(new URL('../compose.yaml', import.meta.url), 'utf-8'))
    const service = compose.services?.ductum ?? {}
    const env = service.environment ?? {}
    const volumes = service.volumes ?? []

    expect(env).not.toHaveProperty('DUCTUM_OPERATOR_TOKEN')
    expect(env).not.toHaveProperty('DUCTUM_CONFIG')
    expect(volumes.some((volume) => typeof volume === 'string' && volume.includes('ductum.yaml'))).toBe(false)
  })
})
