# impl-008: Containerized Deployment

**Status:** Draft
**Priority:** Medium — needed for production, team use, and CI integration
**Depends on:** impl-007 (worktrees — agents need isolation in containers too)

## Problem

Ductum currently runs as a local dev tool: `pnpm serve` starts everything in one process. For production and team use, it needs:
- Reproducible deployment (not "install Node, pnpm, run serve")
- Process isolation (API server vs agent sessions)
- Persistent storage (SQLite across container restarts, or switch to PostgreSQL)
- Secret management (API keys not in shell env)
- Health checks and restart policies
- Multi-machine: API on a server, agents on GPU machines or cloud runners

## Goals

1. Single Dockerfile that builds the complete Ductum server (API + dashboard + dispatcher)
2. Docker Compose for local dev (Ductum + optional PostgreSQL)
3. Agent execution options: local process, Docker sidecar, or remote
4. Volume mounts for repos and DB persistence
5. Environment-based configuration (12-factor)

## Non-Goals

- Kubernetes deployment (future — start with Docker Compose)
- Multi-tenant (one factory per deployment)
- Cloud-managed database (start with SQLite volumes, PostgreSQL optional)
- Agent sandboxing via containers (Edictum handles enforcement, container is for deployment)

## Architecture

### Container layout

```
┌─────────────────────────────────────────┐
│  ductum-server container               │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Hono API + Dashboard (static)   │  │
│  │ :4100                           │  │
│  └──────────────┬─────────────────┘  │
│         │                               │
│  ┌──────┴──────┐                        │
│  │ Dispatcher  │                        │
│  │ (in-process)│                        │
│  └──────┬──────┘                        │
│         │                               │
│  Volumes:                               │
│  /data/ductum.db (SQLite)               │
│  /config/ductum.yaml                    │
│  /repos/* (mounted repo checkouts)      │
└─────────┬───────────────────────────────┘
          │
          │ spawns agent sessions
          ▼
┌─────────────────────┐  ┌───────────────────┐
│ Claude Agent SDK    │  │ OpenCode          │
│ (local process)     │  │ (local or remote) │
└─────────────────────┘  └───────────────────┘
```

### Dockerfile strategy

Multi-stage build:
1. **Stage 1 (build)**: Install deps, build all packages
2. **Stage 2 (runtime)**: Node 22 slim, copy dist + node_modules, expose ports

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/packages/*/dist ./packages/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
# ... copy dashboard dist, serve script, etc.
EXPOSE 4100
CMD ["node", "scripts/serve.mjs"]
```

### Docker Compose

```yaml
services:
  ductum:
    build: .
    ports:
      - "4100:4100"
    volumes:
      - ./ductum.yaml:/config/ductum.yaml
      - ductum-data:/data
      - /path/to/repos:/repos
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DUCTUM_DB_PATH=/data/ductum.db
      - DUCTUM_CONFIG=/config/ductum.yaml
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4100/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  ductum-data:
```

### Configuration via environment

| Env var | Default | Description |
|---------|---------|-------------|
| DUCTUM_CONFIG | ./ductum.yaml | Config file path |
| DUCTUM_DB_PATH | ./ductum.db | SQLite database path |
| DUCTUM_PORT | 4100 | API + dashboard port |
| ANTHROPIC_API_KEY | (conditional) | Required only when a claude-agent-sdk agent is configured |
| OPENCODE_URL | http://localhost:4097 | OpenCode server URL |

### Runtime tool dependencies

The container needs more than just Node.js:
- **git**: required for worktree creation (impl-007), branch operations
- **gh** (GitHub CLI): required by CI/review watchers for `gh pr checks`,
  `gh run view` (packages/core/src/watcher.ts:54)
- **curl**: required for health checks and OpenCode communication
- **Claude CLI**: required if dispatching to claude-agent-sdk harness agents

Install in the runtime stage of the Dockerfile, not just the build stage.

### Agent execution modes

1. **Local process** (current): Claude Agent SDK spawns a child process
   - Works in Docker if Claude CLI is installed in the container
   - Repos must be volume-mounted
   - Claude CLI install: `npm i -g @anthropic-ai/claude-code`

2. **Remote agent**: Agents run on separate machines
   - Dispatcher sends task via HTTP to a remote agent runner
   - Future work — not in this spec

## Acceptance Criteria

1. `docker build -t ductum .` builds successfully
2. `docker compose up` starts Ductum with persistent DB
3. API + dashboard accessible at localhost:4100 (single port, Hono serves static dashboard)
4. Config via ductum.yaml volume mount
5. DB survives container restart (volume mount)
7. Health check passes
8. Agent dispatch works from within container (Claude Agent SDK installed)
