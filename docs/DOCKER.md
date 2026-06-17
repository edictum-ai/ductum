# Docker Development

Ductum has two container paths:

- `docker compose up --build` starts the dev container with hot reload.
- `docker build --target runtime -t ductum:local .` builds a single-port runtime image.

## Hot Reload

The compose service bind-mounts the repo at `/app`, keeps Linux `node_modules`
inside named volumes, and runs:

```bash
pnpm dev:hot
```

That script builds once, then runs TypeScript watchers for the backend
packages, Node's API watch mode, and Vite HMR for the dashboard.

URLs:

- API: `http://localhost:4100`
- Dashboard: `http://localhost:5176`

To run beside another local Ductum stack, override the host ports:

```bash
DUCTUM_API_HOST_PORT=4210 DUCTUM_DASHBOARD_HOST_PORT=5276 docker compose up --build
```

The container is DB-only. The Factory lives in SQLite in the `/data` volume
(`/data/ductum.db`) alongside `/data/.ductum/secrets.key`; there is no config
file mount. Run `ductum init --dir /data` once on a fresh volume to create the
Factory, then `scripts/serve.mjs` starts the API from that DB. Keep secrets in
`.env.local`; `scripts/serve.mjs` reads it inside the mounted repo before
spawning the API. Add agents from the UI after the matching env vars are
present.

## First Run

```bash
docker compose up --build
curl http://localhost:4100/api/health
```

On first run, `scripts/serve.mjs` creates a strong `DUCTUM_OPERATOR_TOKEN` and
saves it to `.env.local` inside the bind-mounted repo. The token is not printed.
CLI commands run from the repo root read `.env.local` automatically.

Agent CLIs still need credentials. For a pure onboarding smoke test, the UI,
settings, project seed, CLI, and dashboard should work before a real dispatch.

## Runtime Image

```bash
docker build --target runtime -t ductum:local .
# Initialize the Factory in the data volume once (creates /data/ductum.db and
# /data/.ductum/secrets.key):
docker run --rm -v ductum-data:/data ductum:local \
  node packages/cli/dist/index.js init --dir /data --no-login --no-browser --no-git
# Then start the API against that DB-only Factory:
docker run --rm \
  -p 4100:4100 \
  -v ductum-data:/data \
  -e DUCTUM_OPERATOR_TOKEN="$(openssl rand -hex 32)" \
  ductum:local
```

The runtime image serves the built dashboard from the Hono API on `:4100`.
Use the dev compose service while working on UI or API code.

## Current Limits

- The image includes `git`, `curl`, and SSH client tools, but not global Claude,
  Codex, or Pi CLIs. Add those deliberately once the harness choice is settled.
- SQLite persists in the `ductum-data` volume.
- For a public deploy, set or preserve a real `DUCTUM_OPERATOR_TOKEN` and wire
  the reverse proxy/TLS before exposing the API.
