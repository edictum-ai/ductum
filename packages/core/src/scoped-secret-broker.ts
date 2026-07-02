import type { Agent, Harness } from './types.js'
import type { FactorySecretResolver } from './factory-secret-resolver.js'
import type { FactorySecretAccessContext } from './factory-settings-store-types.js'
import { parseFactorySecretRef } from './factory-secret-refs.js'
import { log } from './logger.js'

export type SecretBrokerMode = 'warn' | 'enforce'

export interface ScopedSecretBrokerDeps {
  /** Resolves `secret:<id>` references to plaintext from the encrypted FactorySecret store. */
  resolver: Pick<FactorySecretResolver, 'resolve'>
  /**
   * 'warn' (default): preserve current behavior (full host env reaches the agent) but log which
   * host vars enforce mode would withhold, so the operator can verify impact before flipping.
   * 'enforce': the dispatched agent receives ONLY the scoped env; the host environment is never spread.
   */
  mode?: SecretBrokerMode
  /** Per-harness allowlist of host env var NAMES the harness genuinely needs (e.g. its model credential). */
  requiredHostEnv?: Partial<Record<Harness, readonly string[]>>
  /** Host environment source. Injectable for tests; defaults to process.env. */
  hostEnv?: NodeJS.ProcessEnv
}

export interface MaterializedEnv {
  /** The environment to hand the spawned agent. */
  env: Record<string, string>
  /** Host env keys enforce mode withholds (computed in both modes for visibility). */
  droppedKeys: string[]
  mode: SecretBrokerMode
}

/** Host vars every harness needs just to execute, plus network egress (proxy / custom CA) so a
 * scoped agent can still reach the model API. Withholding a proxy/CA var is the most common way an
 * enforce-mode agent breaks, so they are allowlisted here. */
const BASE_HOST_ALLOWLIST: readonly string[] = [
  // shell / locale / paths every subprocess needs to run at all
  'PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'TERM', 'TZ',
  // network egress through corporate proxies / custom CAs — required for the model APIs to connect
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE',
]

/**
 * Conservative per-harness host credential allowlist. Kept here so closing the leak does not
 * break authentication; warn mode surfaces anything missing from this list before enforce is on.
 */
const DEFAULT_REQUIRED_HOST_ENV: Partial<Record<Harness, readonly string[]>> = {
  'claude-agent-sdk': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  'codex-app-server': ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'DUCTUM_CODEX_COMMAND'],
  'codex-sdk': ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'DUCTUM_CODEX_COMMAND'],
  'copilot-sdk': ['COPILOT_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_API_KEY'],
}

const LOG_TAG = 'secret-broker'

/**
 * Builds the minimal, scoped environment for a dispatched agent instead of letting it inherit
 * the entire host process environment. Closes the host-env leak (the `...process.env` spread in
 * the Claude and Codex harnesses) where unrelated host secrets reached every agent.
 *
 * Decoupled from the secret store: the dispatcher injects `materializeEnv` as a callback; the
 * broker itself only needs a resolver, so the dispatcher never holds the FactorySecret deps.
 */
export class ScopedSecretBroker {
  private readonly resolver: Pick<FactorySecretResolver, 'resolve'>
  private readonly mode: SecretBrokerMode
  private readonly requiredHostEnv: Partial<Record<Harness, readonly string[]>>
  private readonly hostEnv: NodeJS.ProcessEnv

  constructor(deps: ScopedSecretBrokerDeps) {
    this.resolver = deps.resolver
    this.mode = deps.mode ?? 'warn'
    this.requiredHostEnv = deps.requiredHostEnv ?? DEFAULT_REQUIRED_HOST_ENV
    this.hostEnv = deps.hostEnv ?? process.env
  }

  /**
   * Resolve the environment for an agent about to be spawned. Never spreads host env in enforce mode.
   *
   * `context` carries the run/agent identity for the access log (P1 / issue #210).
   * The dispatcher always has both; tests and other callers may omit them, in
   * which case access events are still recorded but with null run/agent ids.
   */
  materializeEnv(agent: Agent, context?: FactorySecretAccessContext): MaterializedEnv {
    const scoped = this.buildScopedEnv(agent, context)
    const scopedKeys = new Set(Object.keys(scoped))
    const droppedKeys = Object.keys(this.hostEnv)
      .filter((key) => this.hostEnv[key] != null && !scopedKeys.has(key))
      .sort()

    if (this.mode === 'enforce') {
      return { env: scoped, droppedKeys, mode: 'enforce' }
    }

    if (droppedKeys.length > 0) {
      log.warn(
        LOG_TAG,
        `enforce mode would withhold ${droppedKeys.length} host env var(s) from agent "${agent.name}" (${agent.harness}); running in warn mode (no change)`,
        { droppedKeys },
      )
    }
    return { env: this.buildFullEnv(agent), droppedKeys, mode: 'warn' }
  }

  private buildScopedEnv(agent: Agent, context: FactorySecretAccessContext | undefined): Record<string, string> {
    const env: Record<string, string> = {}
    const allow = new Set<string>(BASE_HOST_ALLOWLIST)
    for (const name of this.requiredHostEnv[agent.harness] ?? []) allow.add(name)
    for (const name of allow) {
      const value = this.hostEnv[name]
      if (value != null) env[name] = value
    }
    // Agent-declared env: resolve `secret:<id>` refs to plaintext; pass literal values through.
    for (const [key, value] of Object.entries(agent.spawnConfig.env ?? {})) {
      env[key] = this.resolveValue(value, context)
    }
    return env
  }

  /** Warn-mode env: current behavior (full host env + literal agent env) so nothing live breaks. */
  private buildFullEnv(agent: Agent): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(this.hostEnv)) {
      if (value != null) env[key] = value
    }
    for (const [key, value] of Object.entries(agent.spawnConfig.env ?? {})) {
      env[key] = value
    }
    return env
  }

  private resolveValue(value: string, context: FactorySecretAccessContext | undefined): string {
    return parseFactorySecretRef(value) != null ? this.resolver.resolve(value, context) : value
  }
}
