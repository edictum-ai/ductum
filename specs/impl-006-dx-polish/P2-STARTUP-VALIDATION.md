# P2: Startup Validation + Structured Logging

**Scope:** Validate environment on startup, replace console.log with structured logger
**Package:** `packages/api`, `packages/core`, `packages/harness`
**Depends on:** None

---

## Required Reading

- `packages/api/src/index.ts` — current startup (reads args at line ~32, workflow at ~61)
- `scripts/serve.mjs` — seeds config, spawns processes
- `ductum.yaml` — declares which harnesses are used per agent

## Tasks

### 1. Conditional env var validation

Validation must be conditional on configured harnesses and dispatch mode:

```typescript
function validateEnv(config: DuctumConfig) {
  const errors: string[] = []

  // Only require ANTHROPIC_API_KEY if any agent uses claude-agent-sdk harness
  const hasClaude = Object.values(config.agents).some(a => a.harness === 'claude-agent-sdk')
  if (hasClaude && !process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is required (agent using claude-agent-sdk harness)')
  }

  // Only require OPENCODE_URL check if any agent uses opencode harness
  const hasOpenCode = Object.values(config.agents).some(a => a.harness === 'opencode')
  if (hasOpenCode) {
    // Warn if OpenCode isn't reachable (non-fatal — it might start later)
    log.warn('startup', 'OpenCode harness configured — ensure opencode serve is running')
  }

  // Port validation (only if set)
  const port = process.env.DUCTUM_PORT
  if (port && (isNaN(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
    errors.push(`DUCTUM_PORT must be a valid port number, got: ${port}`)
  }

  if (errors.length > 0) {
    console.error('Startup validation failed:')
    errors.forEach(e => console.error(`  - ${e}`))
    process.exit(1)
  }
}
```

Note: DUCTUM_REPO_PATH_MAP is set by serve.mjs dynamically — do NOT
require it as an env var. It's an internal channel between serve.mjs and
the API process.

### 2. Structured logger

Create a simple logger at `packages/core/src/logger.ts`:
```typescript
export const log = {
  info: (tag: string, msg: string, data?: Record<string, unknown>) => ...,
  warn: (tag: string, msg: string, data?: Record<string, unknown>) => ...,
  error: (tag: string, msg: string, data?: Record<string, unknown>) => ...,
}
```

Format: `[HH:MM:SS] [tag] level: message {data}`
Replace console.log/error across ALL production source files:
- `packages/core/src/` — dispatcher, enforce, state-machine, dag, watchers
- `packages/api/src/` — index.ts (startup logs), routes, run-ops
- `packages/harness/src/` — claude.ts, opencode.ts
Exclude test files — they can keep console.log.

### 3. Clean up .gitignore

Ensure .gitignore covers:
- `dist/` in all packages
- `*.js` and `*.js.map` in src/ dirs (build artifacts)
- `ductum.db*`
- `node_modules/`

## Verification

- [ ] Missing ANTHROPIC_API_KEY with claude agent → clear error on startup
- [ ] Missing ANTHROPIC_API_KEY with opencode-only agents → no error
- [ ] Invalid DUCTUM_PORT → clear error
- [ ] No bare console.log in packages/core, packages/api, packages/harness source files (excluding tests)
- [ ] .gitignore prevents build artifact commits
