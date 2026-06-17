import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

import {
  BOOTSTRAP_STATE_RELATIVE_PATH,
  findAmbientCreds,
  findEnvKeys,
  formatProviderSource,
  getApiKeyEnvVars,
  parseVersion,
  readBootstrapState,
  resolveProviders,
  versionAtLeast,
  writeBootstrapState,
} from './bootstrap-support.mjs'

const dirs = []
const tests = []

test('parses semver-looking version strings', () => {
  assert.deepEqual(parseVersion('10.11.0'), { major: 10, minor: 11, patch: 0 })
  assert.deepEqual(parseVersion('v22.3.1'), { major: 22, minor: 3, patch: 1 })
  assert.equal(parseVersion('nope'), null)
})

test('compares versions against minimums', () => {
  assert.equal(versionAtLeast('22.0.0', '22.0.0'), true)
  assert.equal(versionAtLeast('22.1.0', '22.0.0'), true)
  assert.equal(versionAtLeast('21.9.9', '22.0.0'), false)
})

test('writes and rereads bootstrap state', () => {
  const root = tempDir()
  const state = { status: 'awaiting_approval', runId: 'run_123' }

  const written = writeBootstrapState(root, state)

  assert.equal(written, resolve(root, BOOTSTRAP_STATE_RELATIVE_PATH))
  assert.deepEqual(readBootstrapState(root), state)
  assert.match(readFileSync(written, 'utf-8'), /"runId": "run_123"/)
})

test('declares canonical provider env vars', () => {
  const vars = getApiKeyEnvVars()

  assert.deepEqual(vars.anthropic, ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'])
  assert.deepEqual(vars.openai, ['OPENAI_API_KEY'])
  assert.deepEqual(vars.copilot, ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'])
})

test('finds and masks provider env keys', () => {
  const found = findEnvKeys({
    ANTHROPIC_OAUTH_TOKEN: 'anthropic-token-1234',
    OPENAI_API_KEY: 'openai-token-1234',
    GH_TOKEN: 'github-token-1234',
  })

  assertPartial(found.anthropic[0], { source: 'ANTHROPIC_OAUTH_TOKEN', value: 'anth…1234' })
  assertPartial(found.openai[0], { source: 'OPENAI_API_KEY', value: 'open…1234' })
  assertPartial(found.copilot[0], { source: 'GH_TOKEN', value: 'gith…1234' })
})

test('finds Anthropic ambient credentials under ~/.claude', async () => {
  const home = tempDir()
  const path = join(home, '.claude', '.credentials.json')
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: 'access-1' } }))

  const providers = await resolveProviders({}, { home, execFileAsync: missingGh })

  assert.equal(providers.length, 1)
  assertPartial(providers[0], { provider: 'anthropic', source: path, sourceType: 'filesystem' })
})

test('finds Anthropic ambient credentials under CLAUDE_CONFIG_DIR', async () => {
  const home = tempDir()
  const configDir = join(home, 'claude-config')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({ access_token: 'access-2' }))

  const ambient = await findAmbientCreds({
    env: { CLAUDE_CONFIG_DIR: configDir },
    home,
    execFileAsync: missingGh,
  })

  assertPartial(ambient.anthropic[0], {
    source: join(configDir, 'credentials.json'),
    value: '<authenticated>',
  })
})

test('finds GitHub Copilot via gh auth status', async () => {
  const providers = await resolveProviders({}, {
    home: tempDir(),
    execFileAsync: async () => ({ stdout: 'github.com\n  ✓ Logged in to github.com account ductum\n', stderr: '' }),
  })

  assert.equal(providers.length, 1)
  assertPartial(providers[0], { provider: 'copilot', source: 'gh auth status', sourceType: 'gh' })
})

test('does not hang provider resolution when gh auth status hangs', async () => {
  let ghCalls = 0
  const hangingGh = () => {
    ghCalls += 1
    return new Promise((resolve) => setTimeout(() => resolve({ stdout: '', stderr: '' }), 75))
  }

  const providers = await resolveProviders({ OPENAI_API_KEY: 'openai-token-1234' }, {
    home: tempDir(),
    execFileAsync: hangingGh,
    ghAuthTimeoutMs: 25,
  })

  assert.equal(ghCalls, 1)
  assert.equal(providers.length, 1)
  assertPartial(providers[0], { provider: 'openai', source: 'OPENAI_API_KEY' })
})

test('finds GitHub Copilot via hosts.yml', async () => {
  const home = tempDir()
  mkdirSync(join(home, '.config', 'gh'), { recursive: true })
  writeFileSync(join(home, '.config', 'gh', 'hosts.yml'), [
    'github.com:',
    '  user: ductum',
    '  oauth_token: ghp_token',
  ].join('\n'))

  const providers = await resolveProviders({}, { home, execFileAsync: missingGh })

  assertPartial(providers[0], {
    provider: 'copilot',
    source: join(home, '.config', 'gh', 'hosts.yml'),
  })
})

test('reports the selected provider source', async () => {
  const providers = await resolveProviders({ OPENAI_API_KEY: 'openai-token-1234' }, {
    home: tempDir(),
    execFileAsync: missingGh,
  })

  assert.equal(formatProviderSource(providers[0]), 'OpenAI via OPENAI_API_KEY')
})

if (process.env.VITEST != null) {
  const { afterEach, describe, it } = await import('vitest')
  afterEach(cleanup)
  describe('bootstrap support helpers', () => {
    for (const entry of tests) it(entry.name, entry.fn)
  })
} else {
  for (const entry of tests) await run(entry.name, entry.fn)
}

function cleanup() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

function test(name, fn) {
  tests.push({ name, fn })
}

async function run(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } finally {
    cleanup()
  }
}

function assertPartial(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual?.[key], value)
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-bootstrap-support-'))
  dirs.push(dir)
  return dir
}

async function missingGh() {
  throw new Error('gh missing')
}
