import { describe, expect, it } from 'vitest'

import {
  publicOutputValue,
  redactPublicOutput,
  redactPublicSpawnConfig,
  redactPublicText,
} from '../index.js'

const SECRETS = [
  'sk-ant-api03-test-secret',
  'sk-proj-test-secret',
  'ghp_testsecret',
  'xoxb-test-secret',
  '123456:telegram-secret',
  'Bearer test-secret',
  'postgres://user:password@example.com/db',
  'ANTHROPIC_AUTH_TOKEN=secret',
  'OPENAI_API_KEY=secret',
  'webhook-secret-value',
]
const EMBEDDED_GENERIC_TOKEN = 'AbC123xyZ456mnopQR789stuV012wxyzAB'

describe('public output redaction', () => {
  it('redacts known secret forms from text', () => {
    const redacted = redactPublicText(SECRETS.join('\n'))

    for (const secret of SECRETS) expect(redacted).not.toContain(secret)
    expect(redacted).toContain('Bearer [redacted]')
    expect(redacted).toContain('postgres://user:[redacted]@example.com/db')
    expect(redacted).toContain('OPENAI_API_KEY=[redacted]')
  })

  it('redacts conservative generic high-entropy tokens embedded in prose', () => {
    expect(redactPublicText(`token ${EMBEDDED_GENERIC_TOKEN} arrived`)).toBe('token [redacted] arrived')
  })

  it('redacts sensitive URL query values including handoff tokens', () => {
    const redacted = redactPublicText([
      'http://127.0.0.1:4777/welcome?token=handoff_secret',
      'http://127.0.0.1:4100/api/events?ductum_operator_token=operator-secret-value&tokensIn=12',
    ].join('\n'))

    expect(redacted).not.toContain('handoff_secret')
    expect(redacted).not.toContain('operator-secret-value')
    expect(redacted).toContain('token=[redacted]')
    expect(redacted).toContain('ductum_operator_token=[redacted]')
    expect(redacted).toContain('tokensIn=12')
  })

  it('redacts structured secret fields while preserving safe readiness metadata', () => {
    const output = redactPublicOutput({
      providerAuth: { anthropic: { state: 'configured', source: 'env', envVar: 'ANTHROPIC_AUTH_TOKEN' } },
      telegram: { botToken: '123456:telegram-secret', webhookSecret: 'webhook-secret-value' },
      encryptedSecret: { ciphertext: 'secret-ciphertext-value', authTag: 'secret-auth-tag', keyId: 'local:key-id' },
      databaseUrl: 'postgres://user:password@example.com/db',
      header: 'Bearer test-secret',
    })

    expect(output.providerAuth.anthropic).toEqual({
      state: 'configured',
      source: 'env',
      envVar: 'ANTHROPIC_AUTH_TOKEN',
    })
    expect(JSON.stringify(output)).not.toContain('123456:telegram-secret')
    expect(JSON.stringify(output)).not.toContain('webhook-secret-value')
    expect(JSON.stringify(output)).not.toContain('secret-ciphertext-value')
    expect(JSON.stringify(output)).not.toContain('secret-auth-tag')
    expect(JSON.stringify(output)).not.toContain('local:key-id')
    expect(JSON.stringify(output)).not.toContain('password@example.com')
    expect(JSON.stringify(output)).not.toContain('Bearer test-secret')
  })

  it('redacts spawn env values but keeps env keys and safe references', () => {
    const output = redactPublicSpawnConfig({
      command: 'codex',
      env: {
        OPENAI_API_KEY: 'sk-proj-test-secret',
        ANTHROPIC_AUTH_TOKEN: '${ANTHROPIC_AUTH_TOKEN}',
        GITHUB_TOKEN: 'secret:github-token',
      },
    })

    expect(output.env).toEqual({
      OPENAI_API_KEY: '[redacted]',
      ANTHROPIC_AUTH_TOKEN: '${ANTHROPIC_AUTH_TOKEN}',
      GITHUB_TOKEN: 'secret:github-token',
    })
  })

  it('renders repair values without hiding safe env-var names', () => {
    expect(publicOutputValue('provider.openai.tokenEnvVar', 'OPENAI_API_KEY')).toBe('OPENAI_API_KEY')
    expect(publicOutputValue('provider.openai.token', 'sk-proj-test-secret')).toBe('[redacted]')
  })

  it('keeps safe status metadata and env references readable', () => {
    const text = [
      'configured',
      'missing',
      'present',
      'unknown',
      '${OPENAI_API_KEY}',
      'OPENAI_API_KEY',
    ].join('\n')

    expect(redactPublicText(text)).toBe(text)
  })

  it('does not redact normal operator text such as paths, filenames, packages, branches, issue ids, and short ids', () => {
    const text = [
      'path packages/core/src/public-redaction.ts',
      'filename run-detail-activity.test.tsx',
      'package @ductum/core',
      'branch fix/high-entropy-redaction',
      'issue #21',
      'id abc123',
      'uuid 123e4567-e89b-12d3-a456-426614174000',
    ].join('\n')

    expect(redactPublicText(text)).toBe(text)
  })

  it('uses field path metadata to redact generic secret-looking values', () => {
    const output = redactPublicOutput({
      field: { path: 'telegram.webhookSecret', label: 'Webhook secret', value: 'webhook-secret-value' },
    })

    expect(output.field).toMatchObject({
      path: 'telegram.webhookSecret',
      label: 'Webhook secret',
      value: '[redacted]',
    })
  })
})
