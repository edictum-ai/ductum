import { describe, expect, it } from 'vitest'

import { formatToolArg, operatorActivityLabel } from '@/lib/run-activity-labels'

const awsAccessKey = 'AKIA1234567890ABCDEF'
const googleApiKey = `AIza${'A'.repeat(35)}`
const slackToken = 'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx'
const jwtToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkdWN0dW0ifQ.secret_signature'
const githubFineGrainedPat = 'github_pat_11AAAAAAA0abcdefghijklmnopqrstuvwxyz'
const stripeSecretKey = 'sk_live_abcdefghijklmnopqrstuvwxyz123456'
const stripeRestrictedKey = 'rk_live_abcdefghijklmnopqrstuvwxyz123456'
const stripeWebhookSecret = 'whsec_abcdefghijklmnopqrstuvwxyz123456'
const embeddedGenericToken = 'AbC123xyZ456mnopQR789stuV012wxyzAB'

describe('run activity labels', () => {
  it.each([
    ['quoted token env var', 'TOKEN="super-secret-value" node scripts/check.mjs', /TOKEN=\[hidden\]/, /super-secret-value/],
    ['authorization bearer header', 'curl -H "Authorization: Bearer sk-super-secret" https://example.test', /Authorization: Bearer \[hidden\]/i, /sk-super-secret/],
    ['authorization basic header', 'curl -H "Authorization: Basic dXNlcjpzZWNyZXQ=" https://example.test', /Authorization: Basic \[hidden\]/i, /dXNlcjpzZWNyZXQ=/],
    ['authorization token header', 'curl -H "Authorization: token ghp_super_secret" https://example.test', /Authorization: token \[hidden\]/i, /ghp_super_secret/],
    ['authorization bare header', 'curl -H "Authorization: super-secret-value" https://example.test', /Authorization: \[hidden\]/i, /super-secret-value/],
    ['authorization aws signature', 'curl -H "Authorization: AWS4-HMAC-SHA256 Credential=AKIA1234567890ABCDEF/20260616/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=abcdef1234567890" https://example.test', /Signature=\[hidden\]/i, /abcdef1234567890/],
    ['api-key header', 'curl -H "x-api-key: super-secret-value" https://example.test', /x-api-key: \[hidden\]/i, /super-secret-value/],
    ['password flag', 'deploy --password=super-secret-value', /--password=\[hidden\]/i, /super-secret-value/],
    ['api key assignment', 'api_key=super-secret-value node scripts/check.mjs', /api_key=\[hidden\]/i, /super-secret-value/],
    ['pat assignment', 'pat=ghp_super_secret git fetch', /pat=\[hidden\]/i, /ghp_super_secret/],
    ['token-only URL userinfo', 'git ls-remote https://ghp_super_secret@github.com/acme/repo', /https:\/\/\[hidden\]@github\.com/, /ghp_super_secret/],
    ['token username URL userinfo', 'git ls-remote https://ghp_super_secret:x-oauth-basic@github.com/acme/repo', /https:\/\/\[hidden\]@github\.com/, /ghp_super_secret/],
    ['database URL userinfo', 'psql postgres://ductum:super_secret@localhost/db', /postgres:\/\/\[hidden\]@localhost/, /super_secret/],
  ])('redacts %s in command metadata', (_name, command, expected, secret) => {
    const label = formatToolArg(JSON.stringify({ command })).main

    expect(label).toMatch(expected)
    expect(label).not.toMatch(secret)
  })

  it('redacts secrets before summary-card compaction can truncate them', () => {
    const command = `${'verify '.repeat(14)}https://ghp_super_secret:x-oauth-basic@github.com/acme/repo`
    const label = formatToolArg(JSON.stringify({ command })).main

    expect(label).toContain('https://[hidden]@github.com')
    expect(label).not.toMatch(/ghp_|ghp_super|ghp_super_secret/)
  })

  it.each([
    ['AWS access key', awsAccessKey],
    ['Google API key', googleApiKey],
    ['Slack token', slackToken],
    ['JWT', jwtToken],
    ['GitHub fine-grained PAT', githubFineGrainedPat],
    ['Stripe secret key', stripeSecretKey],
    ['Stripe restricted key', stripeRestrictedKey],
    ['Stripe webhook secret', stripeWebhookSecret],
  ])('redacts bare %s literals', (_name, secret) => {
    const label = formatToolArg(JSON.stringify({ command: `echo ${secret}` })).main

    expect(label).toBe('echo [hidden]')
    expect(label).not.toContain(secret)
  })

  it('redacts signed URL query values even when parameter names are not obviously secret', () => {
    const label = formatToolArg(JSON.stringify({
      command: 'curl "https://storage.example.test/blob?sig=super-secret-value&se=2026-06-16T12%3A00%3A00Z"',
    })).main

    expect(label).toContain('sig=[hidden]')
    expect(label).toContain('se=[hidden]')
    expect(label).not.toContain('super-secret-value')
    expect(label).not.toContain('2026-06-16T12')
  })

  it('redacts secret-bearing search patterns', () => {
    const label = formatToolArg(JSON.stringify({ pattern: 'ghp_super_secret', path: '/project/ductum' }))

    expect(label.main).toBe('[hidden]')
    expect(label.full).not.toContain('ghp_super_secret')
  })

  it.each([
    ['message', { message: 'deploy TOKEN=super-secret-value now' }, 'TOKEN=[hidden]'],
    ['target stage', { target_stage: 'deploy-ghp_super_secret' }, 'deploy-[hidden]'],
    ['file path', { file_path: '/project/ductum/ghp_super_secret/report.md' }, '[hidden]/report.md'],
    ['pattern path detail', { pattern: 'needle', path: '/project/ductum/ghp_super_secret' }, 'in [hidden]'],
  ])('redacts secrets in %s metadata', (_name, payload, expected) => {
    const label = formatToolArg(JSON.stringify(payload))

    expect(`${label.main} ${label.detail ?? ''}`).toContain(expected)
    expect(label.main).not.toContain('ghp_super_secret')
    expect(label.detail ?? '').not.toContain('ghp_super_secret')
    expect(label.full).not.toContain('super-secret-value')
    expect(label.full).not.toContain('ghp_super_secret')
  })

  it('redacts fallback activity titles at the operator label boundary', () => {
    const label = operatorActivityLabel({
      id: 1,
      runId: 'run_1',
      kind: 'text',
      toolName: null,
      content: 'TOKEN=super-secret-value while thinking',
      createdAt: '2026-06-16T12:00:00.000Z',
    })

    expect(label.title).toContain('TOKEN=[hidden]')
    expect(label.title).not.toContain('super-secret-value')
  })

  it('redacts structural secrets before compacting result metadata', () => {
    const prefix = 'x'.repeat(112)
    const label = operatorActivityLabel({
      id: 1,
      runId: 'run_1',
      kind: 'result',
      toolName: 'Bash',
      content: `${prefix}postgres://ductum:super_secret@host/db`,
      createdAt: '2026-06-16T12:00:00.000Z',
    })

    expect(label.meta).toContain('postgres://[hidden]@host')
    expect(label.meta).not.toContain('ductum:super')
    expect(label.meta).not.toContain('super_secret')
  })

  it('redacts full, detail, and raw label fields', () => {
    const arg = formatToolArg(JSON.stringify({
      command: 'TOKEN=super-secret-value node scripts/check.mjs',
      description: 'Authorization: Basic dXNlcjpzZWNyZXQ=',
    }))
    const result = formatToolArg(JSON.stringify({ result: 'TOKEN=super-secret-value done' }))
    const label = operatorActivityLabel({
      id: 1,
      runId: 'run_1',
      kind: 'tool_call',
      toolName: 'Bash',
      content: JSON.stringify({ command: 'TOKEN=super-secret-value node scripts/check.mjs' }),
      createdAt: '2026-06-16T12:00:00.000Z',
    })

    expect(arg.full).not.toContain('super-secret-value')
    expect(arg.detail).toBe('Authorization: Basic [hidden]')
    expect(result.detail).toBe('TOKEN=[hidden] done')
    expect(label.raw).not.toContain('super-secret-value')
  })

  it('redacts conservative generic high-entropy tokens in activity metadata and raw output', () => {
    const label = formatToolArg(JSON.stringify({
      command: `echo ${embeddedGenericToken}`,
      message: `token ${embeddedGenericToken}`,
    }))

    expect(label.main).toBe('echo [hidden]')
    expect(label.full).not.toContain(embeddedGenericToken)
  })
})
