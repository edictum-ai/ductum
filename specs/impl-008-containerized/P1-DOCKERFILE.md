# P1: Dockerfile

**Scope:** Multi-stage Dockerfile that builds and runs Ductum
**Depends on:** None

---

## Required Reading

- `specs/impl-008-containerized/spec.md` §Container layout
- `package.json` — workspace root
- `pnpm-workspace.yaml` — package layout
- `scripts/serve.mjs` — startup script (line ~203: launches Vite from source)
- `packages/api/src/index.ts` — reads workflow file (line ~61)

## Critical Issues to Solve

### 1. Dashboard serving in production

`serve.mjs:203` launches `npx vite --port 5173` which runs the Vite dev server
from source. In a container, the dashboard should be pre-built static files.

Fix: serve the dashboard `dist/` directory with a static file server instead.
Options:
- Use the Hono API server to also serve static files from `packages/dashboard/dist/`
- Or use `vite preview` instead of `vite` (serves from dist/)
- Recommended: add a catch-all route in the API that serves dashboard dist files

```typescript
// In packages/api/src/index.ts — after all API routes
import { serveStatic } from 'hono/serve-static'
app.use('/*', serveStatic({ root: './packages/dashboard/dist' }))
```

This eliminates the need for a separate dashboard port — everything on :4100.

### 2. Workflow file path

`packages/api/src/index.ts:61` reads `workflows/coding-guard.yaml` from the source tree.
In a container, this file needs to be included in the runtime image.

Solution: copy `workflows/` into the runtime image at a known path.
Update the code to read from `process.env.DUCTUM_WORKFLOW_PATH ?? './workflows/coding-guard.yaml'`.

### 3. Repo path mapping inside containers

`serve.mjs:84` builds DUCTUM_REPO_PATH_MAP from ductum.yaml host paths
(e.g., `/Users/acartagena/project/ductum`). Inside a container, these
paths don't exist — repos are volume-mounted under `/repos/`.

Fix: ductum.yaml should support both absolute and relative repo paths.
When running in a container, mount repos and use container-relative paths:
```yaml
projects:
  ductum:
    repos:
      - path: /repos/ductum     # container path (volume mount)
        name: ductum
```

Or: add DUCTUM_REPO_BASE_PATH env var that prefixes all relative repo paths.

## Tasks

### 1. Create Dockerfile

Multi-stage build:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/*/package.json ./packages/
# ... copy each package.json preserving structure
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*
# git: required for worktrees (impl-007) and branch operations
# curl: required for health checks and OpenCode communication
# Install gh CLI (required by CI/review watchers for gh pr checks, gh run view)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*
# Install Claude CLI (only needed if claude-agent-sdk harness is used)
RUN npm i -g @anthropic-ai/claude-code
COPY --from=build /app/packages/*/dist ./packages/
COPY --from=build /app/packages/dashboard/dist ./packages/dashboard/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/workflows ./workflows
EXPOSE 4100
CMD ["node", "scripts/serve.mjs", "--no-dashboard"]
# Dashboard served by Hono static, no separate Vite process
```

### 2. Create .dockerignore

```
node_modules
.git
ductum.db*
dist
*.log
specs/
decisions/
.claude/
```

### 3. Update serve.mjs for production mode

Detect production mode (e.g., `--no-dashboard` flag or `NODE_ENV=production`).
In production:
- Don't spawn Vite dev server
- Dashboard is served by Hono catch-all static route
- Single port (4100) for both API and dashboard

### 4. Test the build

```bash
docker build -t ductum .
docker run -p 4100:4100 \
  -v $(pwd)/ductum.yaml:/config/ductum.yaml \
  -v ductum-data:/data \
  -v /path/to/repos:/repos \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e DUCTUM_CONFIG=/config/ductum.yaml \
  -e DUCTUM_DB_PATH=/data/ductum.db \
  ductum
curl http://localhost:4100/api/health
```

## Verification

- [ ] `docker build -t ductum .` succeeds
- [ ] `docker run` starts API + dashboard on single port :4100
- [ ] Health check passes: `curl localhost:4100/api/health`
- [ ] Dashboard loads at `localhost:4100/` (served by Hono static)
- [ ] Workflow YAML readable inside container
- [ ] git and curl available in runtime image (for worktrees and health checks)
- [ ] Image size < 500MB
