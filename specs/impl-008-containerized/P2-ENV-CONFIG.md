# P2: Environment-Based Configuration

**Scope:** 12-factor config via env vars, configurable DB path and ports
**Package:** `packages/api`, `scripts/serve.mjs`
**Depends on:** P1 (Dockerfile)

---

## Tasks

### 1. Centralize config resolution

Create `packages/core/src/config.ts`:
```typescript
export function resolveConfig() {
  return {
    configPath: process.env.DUCTUM_CONFIG ?? './ductum.yaml',
    dbPath: process.env.DUCTUM_DB_PATH ?? './ductum.db',
    port: parseInt(process.env.DUCTUM_PORT ?? '4100'),
    // No separate dashboard port — dashboard is served by Hono on the same port
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openCodeUrl: process.env.OPENCODE_URL ?? 'http://localhost:4097',
  }
}
```

### 2. Update serve.mjs

Replace hardcoded paths with `resolveConfig()`.
Validate required env vars on startup.

### 3. Update API server

Read DB path from config, not hardcoded `./ductum.db`.

## Verification

- [ ] Can override DB path via DUCTUM_DB_PATH
- [ ] Can override ports via DUCTUM_PORT
- [ ] Missing ANTHROPIC_API_KEY with claude-agent-sdk agent → clear error
- [ ] Missing ANTHROPIC_API_KEY with opencode-only agents → no error
- [ ] Default values work for local dev (no env vars needed)
