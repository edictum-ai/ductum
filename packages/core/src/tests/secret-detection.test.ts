import { describe, expect, it } from 'vitest'

import {
  validateCommandSecrets,
  validateEnvReferenceString,
  validateNoLiteralSecrets,
  type SecretScanIssue,
} from '../index.js'

const STORED_MESSAGE =
  'must reference an environment variable as ${ENV_VAR} or a Ductum secret as secret:<id>; literal secrets are not stored'

describe('validateNoLiteralSecrets', () => {
  it('flags a sensitive key holding a literal secret', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { provider: 'openai', modelId: 'gpt-5.4', accessRef: 'sk-proj-test-secret' },
      'models.gpt-5-4',
      'Factory Settings.Model',
      issues,
    )
    expect(issues).toEqual([
      { path: 'models.gpt-5-4.accessRef', targetField: 'Factory Settings.Model', message: STORED_MESSAGE },
    ])
  })

  it('accepts environment references without flagging them', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { provider: 'openai', modelId: 'gpt-5.4', accessRef: '${OPENAI_API_KEY}' },
      'models.gpt-5-4',
      'Factory Settings.Model',
      issues,
    )
    expect(issues).toEqual([])
  })

  it('accepts Ductum secret refs without flagging them', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { provider: 'openai', modelId: 'gpt-5.4', accessRef: 'secret:openai-api-key' },
      'models.gpt-5-4',
      'Factory Settings.Model',
      issues,
    )
    expect(issues).toEqual([])
  })

  it('treats every non-ref string in a secret container as a secret', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { botToken: '123456:telegram-secret' },
      'notificationChannels.ops.config',
      'Factory Settings.NotificationChannel',
      issues,
      { secretContainer: true },
    )
    expect(issues).toEqual([
      {
        path: 'notificationChannels.ops.config.botToken',
        targetField: 'Factory Settings.NotificationChannel',
        message: STORED_MESSAGE,
      },
    ])
  })

  it('allows env-refs inside a secret container', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { botToken: '${TELEGRAM_BOT_TOKEN}' },
      'notificationChannels.ops.config',
      'Factory Settings.NotificationChannel',
      issues,
      { secretContainer: true },
    )
    expect(issues).toEqual([])
  })

  it('allows Ductum secret refs inside a secret container', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { botToken: 'secret:telegram-bot-token' },
      'notificationChannels.ops.config',
      'Factory Settings.NotificationChannel',
      issues,
      { secretContainer: true },
    )
    expect(issues).toEqual([])
  })

  it('does not flag safe container keys even inside a secret container', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { expose: ['github'], provider: 'host', mode: 'worktree', token: '${GITHUB_TOKEN}' },
      'sandboxProfiles.builder-worktree.credentials',
      'Factory Settings.SandboxProfile',
      issues,
      { secretContainer: true },
    )
    expect(issues).toEqual([])
  })

  it('flags a literal secret behind a safe container alongside its safe keys', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { expose: ['github'], provider: 'host', token: 'ghp_testsecret' },
      'sandboxProfiles.builder-worktree.credentials',
      'Factory Settings.SandboxProfile',
      issues,
      { secretContainer: true },
    )
    expect(issues).toEqual([
      {
        path: 'sandboxProfiles.builder-worktree.credentials.token',
        targetField: 'Factory Settings.SandboxProfile',
        message: STORED_MESSAGE,
      },
    ])
  })

  it('scans nested arrays and objects for sensitive keys', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { env: { OPENAI_API_KEY: 'sk-ant-api03-test-secret', CI: '1' } },
      'agents.codex.spawnConfig',
      'Factory Settings.Agent',
      issues,
    )
    expect(issues).toEqual([
      {
        path: 'agents.codex.spawnConfig.env.OPENAI_API_KEY',
        targetField: 'Factory Settings.Agent',
        message: STORED_MESSAGE,
      },
    ])
  })

  it('never leaks the offending secret value into the issue message or path', () => {
    const issues: SecretScanIssue[] = []
    validateNoLiteralSecrets(
      { accessRef: 'sk-proj-test-secret' },
      'models.gpt-5-4',
      'Factory Settings.Model',
      issues,
    )
    const serialized = JSON.stringify(issues)
    expect(serialized).not.toContain('sk-proj-test-secret')
  })
})

describe('validateEnvReferenceString', () => {
  it('ignores an undefined value', () => {
    const issues: SecretScanIssue[] = []
    validateEnvReferenceString(undefined, 'models.gpt-5-4.accessRef', 'Factory Settings.Model', issues)
    expect(issues).toEqual([])
  })

  it('accepts a valid env reference', () => {
    const issues: SecretScanIssue[] = []
    validateEnvReferenceString('${OPENAI_API_KEY}', 'models.gpt-5-4.accessRef', 'Factory Settings.Model', issues)
    expect(issues).toEqual([])
  })

  it('accepts a valid Ductum secret reference', () => {
    const issues: SecretScanIssue[] = []
    validateEnvReferenceString('secret:openai-api-key', 'models.gpt-5-4.accessRef', 'Factory Settings.Model', issues)
    expect(issues).toEqual([])
  })

  it('flags a literal string that is not an env reference', () => {
    const issues: SecretScanIssue[] = []
    validateEnvReferenceString('sk-proj-test-secret', 'models.gpt-5-4.accessRef', 'Factory Settings.Model', issues)
    expect(issues).toEqual([
      { path: 'models.gpt-5-4.accessRef', targetField: 'Factory Settings.Model', message: STORED_MESSAGE },
    ])
  })
})

describe('validateCommandSecrets', () => {
  it('ignores an undefined command', () => {
    const issues: SecretScanIssue[] = []
    validateCommandSecrets(undefined, 'harnesses.codex-sdk.command', 'Factory Settings.Harness', issues)
    expect(issues).toEqual([])
  })

  it('flags a sensitive env assignment with a literal value', () => {
    const issues: SecretScanIssue[] = []
    validateCommandSecrets(
      'OPENAI_API_KEY=secret codex',
      'harnesses.codex-sdk.command',
      'Factory Settings.Harness',
      issues,
    )
    expect(issues).toEqual([
      { path: 'harnesses.codex-sdk.command', targetField: 'Factory Settings.Harness', message: STORED_MESSAGE },
    ])
  })

  it('accepts a sensitive env assignment that references an env variable', () => {
    const issues: SecretScanIssue[] = []
    validateCommandSecrets(
      'OPENAI_API_KEY=${OPENAI_API_KEY} codex',
      'harnesses.codex-sdk.command',
      'Factory Settings.Harness',
      issues,
    )
    expect(issues).toEqual([])
  })

  it('accepts a sensitive env assignment that references a Ductum secret', () => {
    const issues: SecretScanIssue[] = []
    validateCommandSecrets(
      'OPENAI_API_KEY=secret:openai-api-key codex',
      'harnesses.codex-sdk.command',
      'Factory Settings.Harness',
      issues,
    )
    expect(issues).toEqual([])
  })

  it('ignores non-sensitive assignments in the command', () => {
    const issues: SecretScanIssue[] = []
    validateCommandSecrets(
      'CI=1 NODE_ENV=production codex',
      'harnesses.codex-sdk.command',
      'Factory Settings.Harness',
      issues,
    )
    expect(issues).toEqual([])
  })

  it('handles quoted literal secret values', () => {
    const issues: SecretScanIssue[] = []
    validateCommandSecrets(
      'GITHUB_TOKEN="ghp_testsecret" gh auth',
      'harnesses.gh.command',
      'Factory Settings.Harness',
      issues,
    )
    expect(issues).toEqual([
      { path: 'harnesses.gh.command', targetField: 'Factory Settings.Harness', message: STORED_MESSAGE },
    ])
  })
})
