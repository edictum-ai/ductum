import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

const CLIENT_ID = Buffer.from('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl', 'base64').toString('utf8')
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_REDIRECT_HOST = 'localhost'
const CALLBACK_PORT = 53692
const CALLBACK_PATH = '/callback'
const DEFAULT_TIMEOUT_MS = 5 * 60_000
export const ANTHROPIC_OAUTH_REDIRECT_URI = redirectUriForPort(CALLBACK_PORT)
export const ANTHROPIC_OAUTH_SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'

export interface OAuthCredentials {
  access: string
  refresh: string
  expires: number
}

export interface PkceMaterial {
  verifier: string
  challenge: string
  state: string
}

export interface LoginAnthropicOptions {
  fetch?: typeof fetch
  createServer?: typeof createServer
  openBrowser?: (url: string) => Promise<void> | void
  generatePKCE?: () => Promise<PkceMaterial>
  host?: string
  port?: number
  timeoutMs?: number
  signal?: AbortSignal
  onAuth?: (url: string) => void
}

export class AuthPkceError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthPkceError'
  }
}

interface CallbackServer {
  server: Server
  redirectUri: string
  waitForCode: Promise<{ code: string; state: string }>
}

export async function loginAnthropicWithPkce(options: LoginAnthropicOptions = {}): Promise<OAuthCredentials> {
  const pkce = await (options.generatePKCE ?? generatePKCE)()
  validatePkceMaterial(pkce)
  const callback = await startCallbackServer(pkce.state, options)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let abortReject: ((error: Error) => void) | undefined
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortReject = reject
  })
  const onAbort = () => abortReject?.(new AuthPkceError('auth_anthropic_failed', 'OAuth login cancelled.'))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (options.signal?.aborted === true) {
      throw new AuthPkceError('auth_anthropic_failed', 'OAuth login cancelled.')
    }
    const authUrl = buildAuthorizeUrl(callback.redirectUri, pkce)
    const codePromise = withTimeout(callback.waitForCode, timeoutMs)
    const codeReady = codePromise.then(() => undefined, () => undefined)
    options.onAuth?.(authUrl)
    await Promise.race([
      Promise.resolve(options.openBrowser?.(authUrl)),
      codeReady,
      abortPromise,
    ])
    const code = await Promise.race([codePromise, abortPromise])
    return await exchangeAuthorizationCode({
      code: code.code,
      state: code.state,
      verifier: pkce.verifier,
      redirectUri: callback.redirectUri,
      fetchFn: options.fetch ?? fetch,
    })
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    callback.server.close()
  }
}

export async function generatePKCE(): Promise<PkceMaterial> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(32))
  return { verifier, challenge, state }
}

export function buildAuthorizeUrl(redirectUri: string, pkce: PkceMaterial): string {
  validatePkceMaterial(pkce)
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: ANTHROPIC_OAUTH_SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: pkce.state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

async function startCallbackServer(
  expectedState: string,
  options: Pick<LoginAnthropicOptions, 'createServer' | 'host' | 'port'>,
): Promise<CallbackServer> {
  const host = options.host ?? CALLBACK_HOST
  if (host !== CALLBACK_HOST) {
    throw new AuthPkceError('auth_pkce_callback_host_invalid', 'OAuth callback server must bind to 127.0.0.1.')
  }
  const makeServer = options.createServer ?? createServer
  return await new Promise((resolve, reject) => {
    let settled = false
    let redirectUri = ''
    let resolveCode!: (value: { code: string; state: string }) => void
    let rejectCode!: (error: Error) => void
    const waitForCode = new Promise<{ code: string; state: string }>((innerResolve, innerReject) => {
      resolveCode = innerResolve
      rejectCode = innerReject
    })
    const server = makeServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? ''}`)
      const callbackUrl = `${requestUrl.origin}${requestUrl.pathname}`
      if (callbackUrl !== redirectUri) {
        writeCallback(res, 404, 'Callback route not found.')
        return
      }
      const error = requestUrl.searchParams.get('error')
      const code = requestUrl.searchParams.get('code')
      const state = requestUrl.searchParams.get('state')
      if (error != null) {
        rejectCode(new AuthPkceError('auth_anthropic_failed', 'Anthropic authentication was rejected.'))
        closeSoon(server)
        writeCallback(res, 400, 'Authentication failed.')
        return
      }
      if (code == null || state == null) {
        rejectCode(new AuthPkceError('auth_anthropic_failed', 'OAuth callback was missing code or state.'))
        closeSoon(server)
        writeCallback(res, 400, 'Missing code or state.')
        return
      }
      if (state !== expectedState) {
        rejectCode(new AuthPkceError('auth_anthropic_failed', 'OAuth state mismatch.'))
        closeSoon(server)
        writeCallback(res, 400, 'State mismatch.')
        return
      }
      resolveCode({ code, state })
      closeSoon(server)
      writeCallback(res, 200, 'Anthropic authentication completed. You can close this window.')
    })
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new AuthPkceError('auth_pkce_callback_port_in_use', 'OAuth callback port is already in use.', { cause: error }))
        return
      }
      reject(error)
    })
    server.listen(options.port ?? CALLBACK_PORT, host, () => {
      if (settled) return
      settled = true
      const address = server.address()
      const port = typeof address === 'object' && address != null ? address.port : options.port
      redirectUri = redirectUriForPort(port)
      resolve({ server, redirectUri, waitForCode })
    })
  })
}

async function exchangeAuthorizationCode(input: {
  code: string
  state: string
  verifier: string
  redirectUri: string
  fetchFn: typeof fetch
}): Promise<OAuthCredentials> {
  const response = await input.fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: input.code,
      state: input.state,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new AuthPkceError('auth_anthropic_failed', `Token exchange failed with HTTP ${response.status}.`)
  }
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (body.access_token == null || body.refresh_token == null || typeof body.expires_in !== 'number') {
    throw new AuthPkceError('auth_anthropic_failed', 'Token exchange returned incomplete credentials.')
  }
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expires: Date.now() + body.expires_in * 1000 - 5 * 60 * 1000,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthPkceError('auth_pkce_callback_timeout', 'OAuth login timed out.')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function validatePkceMaterial(pkce: PkceMaterial): void {
  if (pkce.verifier.length < 43 || pkce.verifier.length > 128) {
    throw new AuthPkceError('auth_anthropic_failed', 'Invalid PKCE verifier length.')
  }
}

function writeCallback(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><title>Ductum login</title><p>${escapeHtml(message)}</p>`)
}

function closeSoon(server: Server): void {
  setImmediate(() => server.close())
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function redirectUriForPort(port: number | undefined): string {
  return `http://${CALLBACK_REDIRECT_HOST}:${port ?? CALLBACK_PORT}${CALLBACK_PATH}`
}
