# P3: Docker Compose

**Scope:** Docker Compose for local dev and deployment
**Depends on:** P1 (Dockerfile), P2 (env config)

---

## Tasks

### 1. Create docker-compose.yml

See spec.md for the full compose file.
Key points:
- Volume for ductum.yaml config
- Volume for persistent DB
- Volume mounts for repo checkouts
- Environment variables from .env file
- Health check on /api/health
- Restart policy: unless-stopped

### 2. Create .env.example

```
ANTHROPIC_API_KEY=your-key-here
DUCTUM_DB_PATH=/data/ductum.db
DUCTUM_CONFIG=/config/ductum.yaml
```

### 3. Documentation

Add to README.md:
- Docker quickstart section
- Volume mount explanation
- How to configure for different repo layouts

### 4. Test full lifecycle

```bash
docker compose up -d
# Load a spec
curl -X POST localhost:4100/api/projects/...
# Verify dispatch works
# Verify DB persists after restart
docker compose restart
curl localhost:4100/api/runs
```

## Verification

- [ ] `docker compose up` starts Ductum
- [ ] Config via volume mount works
- [ ] DB persists across restarts
- [ ] Agent dispatch works from container
- [ ] .env.example documents all variables
