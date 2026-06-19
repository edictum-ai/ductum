import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { envelope } from '../lib/envelope.js'
import type { ApiContext } from '../lib/deps.js'
import { WELCOME_HANDOFF_TTL_MS } from '../lib/handoff-tokens.js'
import { publicOutput } from '../lib/public-output.js'

const COOKIE_NAME = 'ductum_operator_token'
const SAMPLE_NAME = 'hello-readme'

export function registerWelcomeHandoffRoutes(app: Hono, context: ApiContext) {
  app.post('/api/welcome/handoff', (c) => {
    const operatorToken = context.operatorToken?.trim()
    const factory = context.repos.factory.get()
    if (operatorToken == null || operatorToken === '') {
      return welcomeError(c, 401, 'operator_token_missing', 'Operator token is not configured for this factory.', context.now)
    }
    if (factory == null) {
      return welcomeError(c, 404, 'factory_missing', 'Factory must be initialized before minting a welcome handoff token.', context.now)
    }

    const minted = context.handoffTokens.mint({
      factoryId: factory.id,
      operatorToken,
      nowMs: context.now().getTime(),
    })
    return c.json(envelope('welcome.handoff_created', {
      handoffToken: minted.token,
      expiresAt: new Date(minted.expiresAtMs).toISOString(),
      ttlSeconds: WELCOME_HANDOFF_TTL_MS / 1000,
      welcomePath: '/welcome',
    }, context.now))
  })

  app.get('/api/welcome/sample-spec', async (c) => {
    const sample = await readWelcomeSampleSpec()
    return c.json(envelope('welcome.sample_spec', publicOutput(sample), context.now))
  })

  app.post('/api/internal/welcome/exchange', async (c) => {
    const token = await readHandoffToken(c)
    if (token == null) {
      return welcomeError(c, 400, 'handoff_token_missing', 'Welcome handoff token is required.', context.now)
    }
    const factory = context.repos.factory.get()
    if (factory == null) {
      return welcomeError(c, 404, 'factory_missing', 'Factory is not initialized.', context.now)
    }
    const consumed = context.handoffTokens.consume({
      token,
      factoryId: factory.id,
      nowMs: context.now().getTime(),
    })
    if (!consumed.ok) {
      const status = consumed.reason === 'expired' || consumed.reason === 'consumed' ? 410 : 401
      return welcomeError(c, status, `handoff_token_${consumed.reason}`, 'Welcome handoff token is invalid or expired.', context.now)
    }

    c.header('Set-Cookie', serializeOperatorCookie(consumed.operatorToken, shouldUseSecureCookie(c)))
    return c.json(envelope('welcome.handoff_exchanged', publicOutput({
      ok: true,
      factoryId: factory.id,
      expiresAt: new Date(consumed.expiresAtMs).toISOString(),
    }), context.now))
  })
}

async function readWelcomeSampleSpec() {
  const sampleDir = resolveSampleSpecDir(SAMPLE_NAME)
  const [document, prompt] = await Promise.all([
    readFile(join(sampleDir, 'README.md'), 'utf8'),
    readFile(join(sampleDir, 'P1-HELLO-README.md'), 'utf8'),
  ])
  return {
    source: { name: SAMPLE_NAME, path: sampleDir },
    spec: {
      name: SAMPLE_NAME,
      status: 'approved',
      document,
    },
    tasks: [{
      name: 'append-readme-line',
      prompt,
      repos: ['.'],
      verification: ['git diff -- README.md', 'tail -n 5 README.md'],
    }],
  }
}

function resolveSampleSpecDir(name: string): string {
  for (const root of sampleSpecRoots()) {
    const candidate = join(root, name)
    if (existsSync(join(candidate, 'README.md')) && existsSync(join(candidate, 'P1-HELLO-README.md'))) {
      return candidate
    }
  }
  throw new Error(`Welcome sample spec not found: ${name}`)
}

function sampleSpecRoots(): string[] {
  return [
    process.env.DUCTUM_SAMPLE_SPECS_DIR,
    resolve(process.cwd(), 'assets', 'specs', 'examples'),
    resolve(process.cwd(), 'packages', 'ductum', 'assets', 'specs', 'examples'),
    resolve(process.cwd(), '..', '..', 'packages', 'ductum', 'assets', 'specs', 'examples'),
  ].filter((value): value is string => value != null && value.trim() !== '')
}

async function readHandoffToken(c: Context): Promise<string | null> {
  const body = await c.req.json().catch(() => null) as { token?: unknown } | null
  const token = body?.token
  return typeof token === 'string' && token.trim() !== '' ? token.trim() : null
}

function welcomeError(c: Context, status: ContentfulStatusCode, code: string, message: string, now: () => Date) {
  return c.json(envelope('error', publicOutput({
    code,
    message,
    recoverable: true,
    suggestedActions: [],
    context: {},
  }), now), status)
}

function shouldUseSecureCookie(c: Context): boolean {
  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (forwardedProto === 'https') return true
  if (forwardedProto === 'http') return false
  try {
    return new URL(c.req.url).protocol === 'https:'
  } catch {
    return false
  }
}

function serializeOperatorCookie(value: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
  ].join('; ')
}
