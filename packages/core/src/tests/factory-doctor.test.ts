import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildFactoryDoctorReport,
  buildFactorySettingsCatalogs,
  type Agent,
  type ConfigResource,
  type ProjectAgent,
} from '../index.js'

const now = '2026-06-22T00:00:00.000Z'

describe('factory doctor', () => {
  it('blocks a GLM/Z.AI Claude route when the real builder sees a non-Z.AI Anthropic base URL', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('glm-5.2', 'zai', 'glm-5.2'),
        harness('claude-agent-sdk', 'claude-agent-sdk', '/bin/echo'),
      ]),
      agents: [agent('agent-glm', 'glm-builder', 'glm-5.2', 'claude-agent-sdk')],
      assignments: [assignment('agent-glm')],
      env: {
        ZAI_API_KEY: 'sk-zai-secret-do-not-print',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      },
    })

    expect(report.status).toBe('blocked')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'endpoint',
      status: 'blocked',
      refs: ['ANTHROPIC_BASE_URL'],
    }))
    expect(JSON.stringify(report)).not.toContain('sk-zai-secret-do-not-print')
    expect(JSON.stringify(report)).not.toContain('https://api.anthropic.com')
  })

  it('accepts a GLM/Z.AI endpoint from agent spawn env instead of global process env', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('glm-5.2', 'zai', 'glm-5.2'),
        harness('claude-agent-sdk', 'claude-agent-sdk', '/bin/echo'),
      ]),
      agents: [agent('agent-glm', 'glm-builder', 'glm-5.2', 'claude-agent-sdk', {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      })],
      assignments: [assignment('agent-glm')],
      env: { ZAI_API_KEY: 'sk-zai-secret-do-not-print' },
    })

    expect(report.status).toBe('ready')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'endpoint',
      status: 'ready',
      refs: ['ANTHROPIC_BASE_URL'],
    }))
    expect(JSON.stringify(report)).not.toContain('https://api.z.ai/api/anthropic')
    expect(JSON.stringify(report)).not.toContain('sk-zai-secret-do-not-print')
  })

  it('does not require explicit base URL env for providers with SDK default endpoints', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('gpt-5-4', 'openai', 'gpt-5.4'),
        model('sonnet', 'anthropic', 'claude-sonnet-4-6'),
        harness('codex-sdk', 'codex-sdk', '/bin/echo'),
        harness('claude-agent-sdk', 'claude-agent-sdk', '/bin/echo'),
      ]),
      agents: [
        agent('agent-openai', 'codex-builder', 'gpt-5-4', 'codex-sdk'),
        agent('agent-anthropic', 'claude-builder', 'sonnet', 'claude-agent-sdk'),
      ],
      assignments: [assignment('agent-openai'), assignment('agent-anthropic')],
      env: {
        OPENAI_API_KEY: 'sk-openai-secret-do-not-print',
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-secret-do-not-print',
      },
    })

    expect(report.status).toBe('ready')
    const endpointChecks = report.agents.flatMap((entry) => entry.checks.filter((check) => check.kind === 'endpoint'))
    expect(endpointChecks).toHaveLength(2)
    expect(endpointChecks).toEqual([
      expect.objectContaining({ status: 'ready', message: expect.stringContaining('SDK default endpoint') }),
      expect.objectContaining({ status: 'ready', message: expect.stringContaining('SDK default endpoint') }),
    ])
    expect(JSON.stringify(report)).not.toContain('sk-openai-secret-do-not-print')
    expect(JSON.stringify(report)).not.toContain('sk-ant-secret-do-not-print')
  })

  it('accepts an auth probe for OpenAI Codex agents when env credentials are absent', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('gpt-5-4', 'openai', 'gpt-5.4'),
        harness('codex-sdk', 'codex-sdk', '/bin/echo'),
      ]),
      agents: [agent('agent-openai', 'codex-builder', 'gpt-5-4', 'codex-sdk')],
      assignments: [assignment('agent-openai')],
      env: {},
      authProbe: ({ providerId, harnessType }) => providerId === 'openai' && harnessType === 'codex-sdk'
        ? { kind: 'auth', status: 'ready', message: 'Codex login status is active', refs: ['codex'] }
        : null,
    })

    expect(report.status).toBe('ready')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'auth',
      status: 'ready',
      message: 'Codex login status is active',
      refs: ['codex'],
    }))
    expect(JSON.stringify(report)).not.toContain('OPENAI_API_KEY')
  })

  it('accepts GitHub Copilot env auth without deferring the detector', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('github-copilot-gpt-5', 'github-copilot', 'github-copilot-gpt-5'),
        harness('copilot-sdk', 'copilot-sdk', '/bin/echo'),
      ]),
      agents: [agent('agent-copilot', 'copilot-builder', 'github-copilot-gpt-5', 'copilot-sdk')],
      assignments: [assignment('agent-copilot')],
      env: { COPILOT_GITHUB_TOKEN: 'gho_secret-do-not-print' },
    })

    expect(report.status).toBe('ready')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'auth',
      status: 'ready',
      message: 'provider credential env present for github-copilot (COPILOT_GITHUB_TOKEN)',
      refs: ['COPILOT_GITHUB_TOKEN'],
    }))
    expect(JSON.stringify(report)).not.toContain('gho_secret-do-not-print')
  })

  it('accepts a GitHub Copilot auth probe when env credentials are absent', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('github-copilot-gpt-5', 'github-copilot', 'github-copilot-gpt-5'),
        harness('copilot-sdk', 'copilot-sdk', '/bin/echo'),
      ]),
      agents: [agent('agent-copilot', 'copilot-builder', 'github-copilot-gpt-5', 'copilot-sdk')],
      assignments: [assignment('agent-copilot')],
      env: {},
      authProbe: ({ providerId, harnessType }) => providerId === 'github-copilot' && harnessType === 'copilot-sdk'
        ? { kind: 'auth', status: 'ready', message: 'GitHub CLI auth status is active for Copilot', refs: ['gh auth status'] }
        : null,
    })

    expect(report.status).toBe('ready')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'auth',
      status: 'ready',
      message: 'GitHub CLI auth status is active for Copilot',
      refs: ['gh auth status'],
    }))
  })

  it('checks executable permission before accepting a PATH harness command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-doctor-'))
    const commandPath = join(dir, 'not-executable')
    writeFileSync(commandPath, '#!/bin/sh\nexit 0\n')
    chmodSync(commandPath, 0o644)

    const report = buildFactoryDoctorReport({
      catalogs: catalogs([
        model('gpt-5-4', 'openai', 'gpt-5.4'),
        harness('codex-sdk', 'codex-sdk', 'not-executable'),
      ]),
      agents: [agent('agent-openai', 'codex-builder', 'gpt-5-4', 'codex-sdk')],
      assignments: [assignment('agent-openai')],
      env: { OPENAI_API_KEY: 'sk-openai-secret-do-not-print', PATH: dir },
    })

    expect(report.status).toBe('blocked')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'harness_command',
      status: 'blocked',
      message: 'harness command not found on PATH: not-executable',
    }))
  })

  it('marks requested live smoke as deferred instead of pretending it ran', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([model('gpt-5-4', 'openai', 'gpt-5.4'), harness('codex-sdk', 'codex-sdk', '/bin/echo')]),
      agents: [agent('agent-openai', 'codex-builder', 'gpt-5-4', 'codex-sdk')],
      assignments: [assignment('agent-openai')],
      env: { OPENAI_API_KEY: 'sk-openai-secret-do-not-print' },
      liveSmoke: true,
    })

    expect(report.liveSmoke).toEqual({
      enabled: true,
      status: 'deferred',
      reason: 'live smoke was requested but is deferred on this static API doctor; no token-spending request was sent',
    })
  })

  it('reports spawn env reference readiness without blessing literal env values', () => {
    const report = buildFactoryDoctorReport({
      catalogs: catalogs([model('gpt-5-4', 'openai', 'gpt-5.4'), harness('codex-sdk', 'codex-sdk', '/bin/echo')]),
      agents: [agent('agent-openai', 'codex-builder', 'gpt-5-4', 'codex-sdk', { LITERAL_TOKEN: 'literal-do-not-print' })],
      assignments: [assignment('agent-openai')],
      env: { OPENAI_API_KEY: 'sk-openai-secret-do-not-print' },
    })

    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'spawn_env',
      status: 'ready',
      message: 'spawn env references are present; literal values were not inspected or printed',
    }))
    expect(JSON.stringify(report)).not.toContain('literal-do-not-print')
  })
})

function catalogs(configResources: ConfigResource[]) {
  return buildFactorySettingsCatalogs({ configResources, agents: [] })
}

function model(name: string, provider: string, providerModelId: string): ConfigResource {
  return resource('Model', name, { provider, modelId: providerModelId })
}

function harness(name: string, type: string, command: string): ConfigResource {
  return resource('Harness', name, { type, command })
}

function resource(kind: ConfigResource['kind'], name: string, spec: ConfigResource['spec']): ConfigResource {
  return { id: `${kind}-${name}` as ConfigResource['id'], kind, projectId: null, name, spec, createdAt: now, updatedAt: now }
}

function agent(id: string, name: string, modelRef: string, harnessRef: string, env: Record<string, string> = {}): Agent {
  return {
    id: id as Agent['id'],
    name,
    model: modelRef,
    harness: harnessRef as Agent['harness'],
    resourceRefs: { modelRef, harnessRef },
    capabilities: ['build'],
    effort: 'high',
    costTier: 50,
    spawnConfig: { env },
    createdAt: now,
  }
}

function assignment(agentId: string): ProjectAgent {
  return { projectId: 'project-1' as ProjectAgent['projectId'], agentId: agentId as ProjectAgent['agentId'], role: 'builder' }
}
